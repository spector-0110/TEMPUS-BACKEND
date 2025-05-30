// middleware/verifySignature.js
const crypto = require('crypto');
const APP_SECRET = process.env.API_SECRET_PUBLIC;

const verifySignature=async (req, res, next) =>{
  const ts = req.headers['x-timestamp'];
  const sig = req.headers['x-signature'];

  if (!ts || !sig) {
    return res.status(400).json({ error: 'Missing timestamp or signature' });
  }

  // Reject old requests >5 min
  const nowMs = Date.now();
  const age   = Math.abs(nowMs - Number(ts));
  if (age > 5 * 60 * 1000) {
    return res.status(400).json({ error: 'Timestamp expired' });
  }

  // Recompute
  const payload = ts;
  const expected = crypto
    .createHmac('sha256', APP_SECRET)
    .update(payload)
    .digest('hex');

  if (expected !== sig) {
    return res.status(401).json({ error: 'Invalid signature' ,data: { expected, received: sig } });
  }
  /*
[Log] Generated signature details: – {timestamp: "1748600381095", signature: "62d482e4a134e186ac0760e93e7c02b4620796b1a5d4291303628bd233dacf73"}
  */

  next();
}

module.exports = verifySignature;