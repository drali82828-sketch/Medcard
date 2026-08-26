/* ============================================================
   Smart Flashcard — Spaced Repetition Scheduler
   Inspired by SM-2 / FSRS, simplified to three ratings.
   Every card keeps its own `interval` (hours) and `ease` factor,
   so two cards with identical content can end up on completely
   different schedules based on the user's own recall history.
   ============================================================ */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const RATING = { HARD: 'HARD', MEDIUM: 'MEDIUM', EASY: 'EASY' };

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

/**
 * Given a card and a rating, return the updated scheduling fields.
 * Does not mutate the input; caller persists the result.
 */
function schedule(card, rating){
  let { interval = 0, ease = 2.0, reviews = 0, hardCount = 0, mediumCount = 0, easyCount = 0 } = card;
  const isFirstReview = interval === 0;
  let nextIntervalHours;

  if(rating === RATING.HARD){
    ease = clamp(ease - 0.3, 1.3, 3.0);
    nextIntervalHours = isFirstReview ? 1 : Math.max(1, Math.round(interval * 0.5));
    hardCount += 1;
  } else if(rating === RATING.MEDIUM){
    ease = clamp(ease - 0.05, 1.3, 3.0);
    if(isFirstReview) nextIntervalHours = 6;
    else if(interval < 24) nextIntervalHours = 24;
    else nextIntervalHours = Math.round(interval * 1.9);
    mediumCount += 1;
  } else { // EASY
    ease = clamp(ease + 0.15, 1.3, 3.2);
    nextIntervalHours = isFirstReview ? 96 : Math.round(interval * ease);
    easyCount += 1;
  }

  reviews += 1;
  const now = Date.now();
  const nextReview = now + nextIntervalHours * HOUR;

  let status;
  if(rating === RATING.HARD){
    status = 'RELEARNING';
  } else if(nextIntervalHours >= 30 * 24 && reviews >= 3){
    status = 'MASTERED';
  } else if(reviews <= 2){
    status = 'LEARNING';
  } else {
    status = 'REVIEW';
  }

  return {
    ...card,
    interval: nextIntervalHours,
    ease, reviews, hardCount, mediumCount, easyCount,
    lastReview: now, nextReview, status
  };
}

/** Human-readable "next review in ..." string for post-rating feedback. */
function formatInterval(hours){
  if(hours < 1) return 'a few minutes';
  if(hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  if(days < 30) return days === 1 ? '1 day' : `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

/** Derived display status — overlays OVERDUE without losing the stored base status. */
function displayStatus(card, now = Date.now()){
  if(card.status !== 'NEW' && card.status !== 'MASTERED' && card.nextReview < now) return 'OVERDUE';
  return card.status;
}

window.SRS = { RATING, schedule, formatInterval, displayStatus, HOUR, DAY };
