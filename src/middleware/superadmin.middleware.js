const supabase = require('../config/supabase.config');

const superAdminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if user email matches super admin email from env
    if (user.email !== process.env.SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ 
        error: 'Access denied. This action requires super admin privileges.' 
      });
    }

    // Add super admin flag to request
    req.user = {
      ...user,
      isSuperAdmin: true
    };
    
    next();
  } catch (error) {
    console.error('Super admin middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = superAdminMiddleware;