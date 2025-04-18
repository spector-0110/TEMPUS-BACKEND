// const { prisma } = require('../services/database.service');
// const redisService = require('../services/redis.service');
// const messageProcessor = require('../queue/messageProcessor');

// class PatientController {
//     async createPatient(req, res) {
//         try {
//             const hospitalId = req.user.hospital_id;
//             const patientData = req.body;

//             // Add required validation here
//             if (!patientData.name || !patientData.mobile) {
//                 return res.status(400).json({ error: 'Name and mobile are required' });
//             }

//             const patient = await prisma.patient.create({
//                 data: {
//                     ...patientData,
//                     hospitalId
//                 }
//             });

//             // Queue welcome message if email is provided
//             if (patient.email) {
//                 await messageProcessor.publishNotification({
//                     type: 'EMAIL',
//                     to: patient.email,
//                     subject: 'Welcome to Our Hospital',
//                     content: `Dear ${patient.name}, welcome to our healthcare family.`
//                 });
//             }

//             return res.status(201).json(patient);
//         } catch (error) {
//             console.error('Error creating patient:', error);
//             return res.status(500).json({ error: 'Failed to create patient' });
//         }
//     }

//     async getPatients(req, res) {
//         try {
//             const hospitalId = req.user.hospital_id;
//             const { page = 1, limit = 10, search } = req.query;

//             const skip = (page - 1) * parseInt(limit);
//             const where = {
//                 hospitalId,
//                 ...(search && {
//                     OR: [
//                         { name: { contains: search, mode: 'insensitive' } },
//                         { mobile: { contains: search } },
//                         { email: { contains: search, mode: 'insensitive' } }
//                     ]
//                 })
//             };

//             const [total, patients] = await Promise.all([
//                 prisma.patient.count({ where }),
//                 prisma.patient.findMany({
//                     where,
//                     skip,
//                     take: parseInt(limit),
//                     orderBy: { createdAt: 'desc' },
//                     include: {
//                         appointments: {
//                             select: {
//                                 id: true,
//                                 appointmentDate: true,
//                                 status: true
//                             },
//                             orderBy: { appointmentDate: 'desc' },
//                             take: 1
//                         }
//                     }
//                 })
//             ]);

//             return res.json({
//                 patients,
//                 pagination: {
//                     total,
//                     pages: Math.ceil(total / limit),
//                     currentPage: parseInt(page),
//                     limit: parseInt(limit)
//                 }
//             });
//         } catch (error) {
//             console.error('Error fetching patients:', error);
//             return res.status(500).json({ error: 'Failed to fetch patients' });
//         }
//     }

//     async getPatientDetails(req, res) {
//         try {
//             const { id } = req.params;
//             const hospitalId = req.user.hospital_id;

//             const patient = await prisma.patient.findFirst({
//                 where: {
//                     id,
//                     hospitalId
//                 },
//                 include: {
//                     appointments: {
//                         include: {
//                             doctor: {
//                                 select: {
//                                     id: true,
//                                     name: true,
//                                     specialization: true
//                                 }
//                             }
//                         },
//                         orderBy: { appointmentDate: 'desc' }
//                     }
//                 }
//             });

//             if (!patient) {
//                 return res.status(404).json({ error: 'Patient not found' });
//             }

//             return res.json(patient);
//         } catch (error) {
//             console.error('Error fetching patient details:', error);
//             return res.status(500).json({ error: 'Failed to fetch patient details' });
//         }
//     }

//     async updatePatient(req, res) {
//         try {
//             const { id } = req.params;
//             const hospitalId = req.user.hospital_id;
//             const updateData = req.body;

//             // Verify patient belongs to hospital
//             const existingPatient = await prisma.patient.findFirst({
//                 where: {
//                     id,
//                     hospitalId
//                 }
//             });

//             if (!existingPatient) {
//                 return res.status(404).json({ error: 'Patient not found' });
//             }

//             const updatedPatient = await prisma.patient.update({
//                 where: { id },
//                 data: updateData
//             });

//             return res.json(updatedPatient);
//         } catch (error) {
//             console.error('Error updating patient:', error);
//             return res.status(500).json({ error: 'Failed to update patient' });
//         }
//     }

//     async deletePatient(req, res) {
//         try {
//             const { id } = req.params;
//             const hospitalId = req.user.hospital_id;

//             // Verify patient belongs to hospital
//             const existingPatient = await prisma.patient.findFirst({
//                 where: {
//                     id,
//                     hospitalId
//                 }
//             });

//             if (!existingPatient) {
//                 return res.status(404).json({ error: 'Patient not found' });
//             }

//             await prisma.patient.delete({
//                 where: { id }
//             });

//             return res.json({ message: 'Patient deleted successfully' });
//         } catch (error) {
//             console.error('Error deleting patient:', error);
//             return res.status(500).json({ error: 'Failed to delete patient' });
//         }
//     }

//     async getPatientAppointments(req, res) {
//         try {
//             const { id } = req.params;
//             const hospitalId = req.user.hospital_id;
//             const { status, page = 1, limit = 10 } = req.query;

//             const skip = (page - 1) * parseInt(limit);
//             const where = {
//                 patientId: id,
//                 hospitalId,
//                 ...(status && { status })
//             };

//             const [total, appointments] = await Promise.all([
//                 prisma.appointment.count({ where }),
//                 prisma.appointment.findMany({
//                     where,
//                     skip,
//                     take: parseInt(limit),
//                     orderBy: { appointmentDate: 'desc' },
//                     include: {
//                         doctor: {
//                             select: {
//                                 id: true,
//                                 name: true,
//                                 specialization: true
//                             }
//                         }
//                     }
//                 })
//             ]);

//             return res.json({
//                 appointments,
//                 pagination: {
//                     total,
//                     pages: Math.ceil(total / limit),
//                     currentPage: parseInt(page),
//                     limit: parseInt(limit)
//                 }
//             });
//         } catch (error) {
//             console.error('Error fetching patient appointments:', error);
//             return res.status(500).json({ error: 'Failed to fetch appointments' });
//         }
//     }
// }

// module.exports = new PatientController();