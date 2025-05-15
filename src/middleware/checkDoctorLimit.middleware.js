const SubscriptionService =require('../modules/subscription/subscription.service')
const DoctorService = require('../modules/doctor/doctor.service')

const checkDoctorLimitMiddleware =async (req,res,next)=>{
    try{

        const hospitalId = req.user.hospital_id;
    
        // Check if the user is a super admin
        if (req.user.isSuperAdmin) {
          return next();
        }
    
        // Check if the hospital has an active subscription
    const subscription = await SubscriptionService.getHospitalSubscription(hospitalId,false);
        if (!subscription) {
            return res.status(404).json({ error: 'No active subscription found' });
        }
    
        const currentDoctorCount = await DoctorService.listDoctors(hospitalId);
        if (currentDoctorCount.length >= subscription.doctorCount) {
            return res.status(403).json({ error: 'Doctor limit reached for current subscription' });
        }

        next();

    }catch(error){
        console.error('Error Creating the doctor in middleware:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }

}
module.exports = checkDoctorLimitMiddleware;