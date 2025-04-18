const express = require('express');
const router = express.Router();
const patientController = require('../modules/patient/patient.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All patient routes require authentication
router.use(authMiddleware);

// Patient management routes
router.post('/', patientController.createPatient);
router.get('/search', patientController.searchPatients);
router.get('/:id', patientController.getPatientDetails);
router.put('/:id', patientController.updatePatientDetails);
router.delete('/:id', patientController.deletePatient);

module.exports = router;