// ── Session-level co-usage tracker ───────────────────────────────────────────
// Tracks which features a student uses within a single page session, detects
// feature pairs (co-usage), multimodal mode, and fires one 'session_ended'
// event to Vercel on page unload.  Safe to load before all other scripts.

window.sessionTracker = (() => {
  const startTime   = Date.now();
  const featuresUsed = new Set();   // unique feature buckets active this session
  const sequence     = [];          // [{feature, t}]  t = seconds from session start

  function use(feature) {
    featuresUsed.add(feature);
    sequence.push({
      feature,
      t: Math.round((Date.now() - startTime) / 1000)
    });
  }

  function flush() {
    const features = [...featuresUsed];

    const has = f => features.includes(f);
    const modality =
      features.length >= 3          ? 'fully_multimodal'  :
      has('whiteboard')              ? 'text_whiteboard'   :
      has('voice')                   ? 'text_voice'        :
      has('file')                    ? 'text_file'         :
      has('quiz')                    ? 'text_quiz'         :
      has('notes') || has('summary') ? 'text_notes'        :
                                       'text_only';

    if (window.va) {
      window.va('event', {
        name: 'session_ended',
        modality,
        feature_count: features.length,
        context: window._inClassMode ? 'in_class' : 'at_home',
      });
    }
  }

  window.addEventListener('beforeunload', flush);

  return { use };
})();

// ── Global track() helper — available to all scripts ─────────────────────────
// Defined here (in session-tracker.js) so tutor-whiteboard.js, student-notes.js,
// and physics-stickers.js can call track() even though they load after this file.
window.track = function track(event, data = {}) {
  const featureMap = {
    message_sent:             'chat',
    file_uploaded:            'file',
    save_chat_clicked:        'chat',
    summary_generated:        'summary',
    quiz_opened:              'quiz',
    voice_input_used:         'voice',
    whiteboard_tab_opened:    'whiteboard',
    whiteboard_draw_toggled:  'whiteboard',
    whiteboard_saved:         'whiteboard',
    whiteboard_sent_to_tutor: 'whiteboard',
    notes_draw_mode_used:     'notes',
    notes_cleared:            'notes',
    notes_saved:              'notes',
  };

  const feature = featureMap[event];
  if (feature && window.sessionTracker) window.sessionTracker.use(feature);

  if (window.va) window.va('event', {
    name: event,
    ...data,
    context: window._inClassMode ? 'in_class' : 'at_home',
  });
};
