// Ask: questions typed in the top bar are answered from your own records on the device
// (matching items, or the weekly brief). Nothing is sent anywhere.
const QUESTION = /^(what|whats|what's|when|who|whom|whose|where|which|why|how|is|are|am|do|does|did|can|could|should|will|would|have|has|had|any|kya|kab|kaun|kahan|kitna|kitni|kitne|kaise|kyun|kis|kisne|mera|meri|mere|tell|show|list|brief|summari[sz]e|remind)\b/i;
export const isQuestion = (q) => /\?\s*$/.test(q) || QUESTION.test(q.trim());
