'use strict';
function createTelemetry(sink) { const emit = typeof sink === 'function' ? sink : () => {}; return { event(name, fields = {}) { const entry = { name, at: Date.now(), ...fields }; try { emit(entry); } catch (_) {} return entry; } }; }
module.exports = { createTelemetry };
