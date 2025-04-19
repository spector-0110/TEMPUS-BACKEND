const supabase = require('../config/supabase.config');
const { prisma } = require('../services/database.service');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Check if this is the initial registration route
    const isInitialRegistration = req.path.endsWith('/initial-details');
    
    // Look up hospital ID for all routes except initial registration
    if (!isInitialRegistration) {
      const hospital = await prisma.hospital.findUnique({
        where: { supabaseUserId: user.id },
        select: { id: true }
      });
      
      if (!hospital) {
        return res.status(404).json({ error: 'Hospital not found for this user' });
      }
      
      user.hospital_id = hospital.id;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = authMiddleware;