/* ============================================================
   Smart Flashcard — Notifications
   On a real Android build (via Capacitor) this schedules real
   system notifications through @capacitor/local-notifications.
   When previewed in a plain desktop browser (no native runtime),
   it falls back to the Web Notifications API so the app is still
   testable — this fallback never runs on the actual APK.
   ============================================================ */
const Notif = (() => {
  function nativePlugin(){
    return (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
      ? window.Capacitor.Plugins.LocalNotifications
      : null;
  }

  async function requestPermission(){
    const plugin = nativePlugin();
    if(plugin){
      const res = await plugin.requestPermissions();
      return res.display === 'granted';
    }
    if('Notification' in window){
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
    return false;
  }

  // Stable 32-bit notification id derived from the card's DB id.
  function notifId(cardId){ return 100000 + (cardId % 900000); }

  async function scheduleForCard(card, dueCount){
    const enabled = await DB.getSetting('notificationsEnabled', true);
    if(!enabled) return;
    const plugin = nativePlugin();
    const body = dueCount && dueCount > 1
      ? `You have ${dueCount} pieces of information ready to review.`
      : 'A card is ready for review.';

    if(plugin){
      try{
        await plugin.cancel({ notifications: [{ id: notifId(card.id) }] });
        await plugin.schedule({
          notifications: [{
            id: notifId(card.id),
            title: '🔔 Time to Review',
            body,
            schedule: { at: new Date(card.nextReview) },
            smallIcon: 'ic_stat_flashcard',
            channelId: 'flashcard-reviews'
          }]
        });
      }catch(err){ console.warn('Notification scheduling failed', err); }
    }
    // No reliable "scheduled for later" fallback exists in a plain browser tab;
    // the web fallback only fires immediate test notifications (see notifyNow).
  }

  async function cancelForCard(cardId){
    const plugin = nativePlugin();
    if(plugin){ try{ await plugin.cancel({ notifications: [{ id: notifId(cardId) }] }); }catch(e){} }
  }

  async function createChannel(){
    const plugin = nativePlugin();
    if(plugin && plugin.createChannel){
      try{
        await plugin.createChannel({
          id: 'flashcard-reviews',
          name: 'Review Reminders',
          description: 'Reminds you when cards are due for review',
          importance: 4,
          visibility: 1
        });
      }catch(e){}
    }
  }

  /** Recompute + reschedule notifications for every card with a future review. */
  async function rescheduleAll(){
    const cards = await DB.getAllCards();
    const now = Date.now();
    const upcoming = cards.filter(c => c.nextReview > now);
    const dueTotal = cards.filter(c => c.nextReview <= now).length;
    for(const c of upcoming){ await scheduleForCard(c, 1); }
    if(dueTotal > 0){
      // Also fire a single "due now" summary the next time the app is backgrounded/opened.
      await DB.setSetting('pendingDueSummary', dueTotal);
    }
  }

  return { requestPermission, scheduleForCard, cancelForCard, createChannel, rescheduleAll };
})();

window.Notif = Notif;
