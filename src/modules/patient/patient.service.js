const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const patientValidator = require('./patient.validator');
const { CACHE_KEYS, CACHE_EXPIRY } = require('./patient.constants');

class PatientService {
  async createPatient(hospitalId, patientData) {
    // Validate patient data first
    const validationResult = patientValidator.validateCreatePatientData(patientData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Check if patient with same email or phone exists
    const existingPatient = await prisma.patient.findFirst({
      where: {
        hospitalId,
        OR: [
          patientData.contact.email ? { 'contact.email': patientData.contact.email } : {},
          { 'contact.phone': patientData.contact.phone }
        ]
      }
    });

    if (existingPatient) {
      throw new Error('A patient with this email or phone number already exists in this hospital');
    }

    // Format address if provided
    if (patientData.address) {
      patientData.address = this.formatAddress(patientData.address);
    }

    // Convert date string to Date object
    patientData.dateOfBirth = new Date(patientData.dateOfBirth);

    // Normalize gender to lowercase
    patientData.gender = patientData.gender.toLowerCase();

    const patient = await prisma.patient.create({
      data: {
        ...patientData,
        hospitalId
      }
    });

    // Invalidate patient list cache for the hospital
    await this.invalidatePatientListCache(hospitalId);

    return patient;
  }

  async getPatientDetails(hospitalId, patientId) {
    const cacheKey = CACHE_KEYS.PATIENT_DETAILS + patientId;
    
    // Try to get from cache first
    const cachedPatient = await redisService.getCache(cacheKey);
    if (cachedPatient) {
      return cachedPatient;
    }

    // If not in cache, fetch from database
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        hospitalId
      }
    });

    if (!patient) {
      throw new Error('Patient not found');
    }

    // Store in cache
    await redisService.setCache(cacheKey, patient, CACHE_EXPIRY.PATIENT_DETAILS);

    return patient;
  }

  async updatePatientDetails(hospitalId, patientId, updateData) {
    // First check if patient exists and belongs to the hospital
    const existingPatient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        hospitalId
      }
    });

    if (!existingPatient) {
      throw new Error('Patient not found');
    }

    // Validate update data
    const validationResult = patientValidator.validateCreatePatientData(updateData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Check for duplicate contact info if being updated
    if (updateData.contact) {
      const duplicatePatient = await prisma.patient.findFirst({
        where: {
          hospitalId,
          id: { not: patientId },
          OR: [
            updateData.contact.email ? { 'contact.email': updateData.contact.email } : {},
            { 'contact.phone': updateData.contact.phone }
          ]
        }
      });

      if (duplicatePatient) {
        throw new Error('Another patient with this email or phone number already exists in this hospital');
      }
    }

    // Format address if provided
    if (updateData.address) {
      updateData.address = this.formatAddress(updateData.address);
    }

    // Convert date if provided
    if (updateData.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateData.dateOfBirth);
    }

    // Normalize gender if provided
    if (updateData.gender) {
      updateData.gender = updateData.gender.toLowerCase();
    }

    const updatedPatient = await prisma.patient.update({
      where: { id: patientId },
      data: updateData
    });

    // Invalidate caches
    await Promise.all([
      redisService.invalidateCache(CACHE_KEYS.PATIENT_DETAILS + patientId),
      this.invalidatePatientListCache(hospitalId)
    ]);

    return updatedPatient;
  }

  async searchPatients(hospitalId, filters = {}, pagination = { page: 1, limit: 10 }) {
    const validationResult = patientValidator.validateSearchFilters(filters);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Invalid filters'), { validationErrors: validationResult.errors });
    }

    const where = { hospitalId };

    // Add filters to where clause
    if (filters.name) {
      where.name = { contains: filters.name, mode: 'insensitive' };
    }
    if (filters.phone) {
      where.contact = { path: '$.phone', string_contains: filters.phone };
    }
    if (filters.uhid) {
      where.uhid = filters.uhid;
    }
    if (filters.fileNumber) {
      where.fileNumber = filters.fileNumber;
    }
    if (filters.dateOfBirth) {
      where.dateOfBirth = new Date(filters.dateOfBirth);
    }

    const skip = (pagination.page - 1) * pagination.limit;

    const [total, patients] = await prisma.$transaction([
      prisma.patient.count({ where }),
      prisma.patient.findMany({
        where,
        skip,
        take: pagination.limit,
        orderBy: { updatedAt: 'desc' }
      })
    ]);

    return {
      data: patients,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit)
      }
    };
  }

  async deletePatient(hospitalId, patientId) {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        hospitalId
      }
    });

    if (!patient) {
      throw new Error('Patient not found');
    }

    await prisma.patient.delete({
      where: { id: patientId }
    });

    // Invalidate caches
    await Promise.all([
      redisService.invalidateCache(CACHE_KEYS.PATIENT_DETAILS + patientId),
      this.invalidatePatientListCache(hospitalId)
    ]);
  }

  // Helper methods
  formatAddress(address) {
    return `${address.street}, ${address.city}, ${address.state}, ${address.pincode}`;
  }

  async invalidatePatientListCache(hospitalId) {
    await redisService.invalidateCache(CACHE_KEYS.PATIENT_LIST + hospitalId);
  }
}

module.exports = new PatientService();