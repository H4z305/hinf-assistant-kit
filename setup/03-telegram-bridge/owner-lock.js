// owner-lock.js
// Sole authorization gate for the Telegram bridge — every inbound message and outbound
// reply is checked against this. Do not bypass or weaken.
function isAuthorized(senderId, ownerId) {
  if (!ownerId) return false;
  return String(senderId) === String(ownerId);
}

module.exports = { isAuthorized };
