const { prisma } = require('../services/database.service');
const otpService = require('../services/otp.service');
const messageProcessor = require('../queue/messageProcessor');

class HospitalController {
  async getHospitalDetails(req, res) {
    try {
      const hospitalId = req.user.hospital_id;
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId }
      });
      
      if (!hospital) {
        return res.status(404).json({ error: 'Hospital not found' });
      }

      return res.json(hospital);
    } catch (error) {
      console.error('Error fetching hospital details:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async requestEditVerification(req, res) {
    try {
      const hospitalId = req.user.hospital_id;
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { adminEmail: true }
      });

      if (!hospital) {
        return res.status(404).json({ error: 'Hospital not found' });
      }

      // Generate OTP
      const otp = await otpService.generateOTP(hospitalId);

      // Send OTP via email
      await messageProcessor.publishNotification({
        type: 'EMAIL',
        to: hospital.adminEmail,
        subject: 'Hospital Edit Verification OTP',
        content: `Your OTP for editing hospital details is: ${otp}. This OTP will expire in 5 minutes.`
      });

      return res.json({ message: 'OTP sent successfully' });
    } catch (error) {
      console.error('Error requesting edit verification:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async verifyEditOTP(req, res) {
    try {
      const { otp } = req.body;
      const hospitalId = req.user.hospital_id;

      if (!otp) {
        return res.status(400).json({ error: 'OTP is required' });
      }

      await otpService.verifyOTP(hospitalId, otp);
      return res.json({ message: 'OTP verified successfully' });
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async updateHospitalDetails(req, res) {
    try {
      const hospitalId = req.user.hospital_id;
      const updateData = req.body;

      // Check if user is verified for editing
      const isVerified = await otpService.checkEditVerificationStatus(hospitalId);
      if (!isVerified) {
        return res.status(403).json({ error: 'OTP verification required for editing' });
      }

      // Update hospital details
      const updatedHospital = await prisma.hospital.update({
        where: { id: hospitalId },
        data: updateData
      });

      // Invalidate edit verification status after successful update
      await otpService.invalidateEditVerificationStatus(hospitalId);

      return res.json(updatedHospital);
    } catch (error) {
      console.error('Error updating hospital details:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getDashboardStats(req, res) {
    try {
      const hospitalId = req.user.hospital_id;

      const [totalAppointments, totalDoctors, subscription] = await Promise.all([
        prisma.appointment.count({ where: { hospitalId } }),
        prisma.doctor.count({ where: { hospitalId } }),
        prisma.hospitalSubscription.findFirst({
          where: { hospitalId, status: 'active' },
          include: { plan: true }
        })
      ]);

      return res.json({
        totalAppointments,
        totalDoctors,
        subscription: {
          plan: subscription?.plan.name,
          expiresAt: subscription?.endDate,
          status: subscription?.status
        }
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new HospitalController();