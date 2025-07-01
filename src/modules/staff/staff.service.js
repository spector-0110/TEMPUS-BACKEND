const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { getCurrentIst } = require('../../utils/timezone.util');

class StaffService {
  
  // Cache keys
  static CACHE_KEYS = {
    STAFF_LIST: 'staff:list:',
    STAFF_DETAILS: 'staff:details:',
    STAFF_PAYMENTS: 'staff:payments:'
  };

  static CACHE_TTL = 300; // 5 minutes

  /**
   * Create a new staff member
   */
  async createStaff(hospitalId, staffData) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }

      // Data is already validated in controller
      const validatedData = staffData;

      // Check if mobile number already exists (if provided)
      if (validatedData.mobileNumber || validatedData.aadhaarCard) {
        const existingStaff = await prisma.staff.findFirst({
          where: {
            mobileNumber: validatedData.mobileNumber,
            aadhaarCard: validatedData.aadhaarCard,
            hospitalId
          }
        });

        if (existingStaff) {
          throw new Error('Staff member with this mobile number or adhaar number already exists');
        }
      }

      // Create staff member with proper hospital connection
      const staff = await prisma.staff.create({
        data: {
          ...validatedData,
          hospital: {
            connect: {
              id: hospitalId
            }
          }
        },
        include: {
          hospital: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidateStaffCaches(hospitalId);

      return staff;
    } catch (error) {
      console.error('Error in createStaff:', error);
      throw error;
    }
  }

  /**
   * Update staff details (limited fields only)
   */
  async updateStaff(hospitalId, staffId, updateData) {
    try {
      // Data is already validated in controller
      const validatedData = updateData;

      // Check if staff exists and belongs to hospital
      const existingStaff = await prisma.staff.findFirst({
        where: {
          id: staffId,
          hospitalId
        }
      });

      if (!existingStaff) {
        throw new Error('Staff member not found');
      }

      // Check for duplicate mobile number and duplicate aadhaar (if being updated)
      if (validatedData.mobileNumber && validatedData.mobileNumber !== existingStaff.mobileNumber || validatedData.aadhaarCard && validatedData.aadhaarCard !== existingStaff.aadhaarCard) {
        const duplicateStaff = await prisma.staff.findFirst({
          where: {
            mobileNumber: validatedData.mobileNumber,
            aadhaarCard: validatedData.aadhaarCard,
            hospitalId,
            id: { not: staffId }
          }
        });

        if (duplicateStaff) {
          throw new Error('Another staff member with this mobile number or aadhaar card already exists');
        }
      }

      // Update staff
      const updatedStaff = await prisma.staff.update({
        where: { id: staffId },
        data: {
          ...validatedData,
          updatedAt: new Date()
        },
        include: {
          hospital: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidateStaffCaches(hospitalId, staffId);

      return updatedStaff;
    } catch (error) {
      console.error('Error in updateStaff:', error);
      throw error;
    }
  }

  /**
   * Get staff details with attendance and payments
   */
  async getStaffDetails(hospitalId, staffId) {
    try {
      const cacheKey = `${StaffService.CACHE_KEYS.STAFF_DETAILS}${staffId}`;
      
      // Try to get from cache first
      let staff = await redisService.getCache(cacheKey);
      
      if (!staff) {
        // Calculate current month start and end dates using Indian timezone
        const nowIST = getCurrentIst();
        const currentMonthStartIST = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
        const currentMonthEndIST = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 0, 23, 59, 59, 999);

        staff = await prisma.staff.findFirst({
          where: {
            id: staffId,
            hospitalId
          },
          include: {
            hospital: {
              select: {
                id: true,
                name: true
              }
            },
            attendances: {
              where: {
                attendanceDate: {
                  gte: currentMonthStartIST,
                  lte: currentMonthEndIST
                }
              },
              orderBy: {
                attendanceDate: 'desc'
              }
            },
            payments: {
              orderBy: {
                paymentDate: 'desc'
              },
              take: 20 // Last 20 payments
            }
          }
        });

        if (!staff) {
          throw new Error('Staff member not found');
        }

        // Cache the result
        await redisService.setCache(cacheKey, staff, StaffService.CACHE_TTL);
      }

      return staff;
    } catch (error) {
      console.error('Error in getStaffDetails:', error);
      throw error;
    }
  }

  /**
   * Get staff by ID - alias for getStaffDetails
   */
  async getStaffById(hospitalId, staffId) {
    return this.getStaffDetails(hospitalId, staffId);
  }

  /**
   * Get all staff members for a hospital with attendance for a specific date
   * @param {string} hospitalId - The hospital ID
   * @param {string} date - The date in YYYY-MM-DD format to fetch attendance for
   */
  async getAllStaff(hospitalId, date) {
    try {
      const cacheKey = `${StaffService.CACHE_KEYS.STAFF_LIST}${hospitalId}:${date}`;
      
      // Try to get from cache first
      let result = await redisService.getCache(cacheKey);
      
      if (!result) {
        const whereClause = {
          hospitalId
        };

        // Parse the date string from frontend (expected format: YYYY-MM-DD)
        const dateOnly = new Date(date);

        const staff = await prisma.staff.findMany({
          where: whereClause,
          include: {
            attendances: {
              where: {
                attendanceDate: {
                  equals: dateOnly
                }
              },
              select: {
                status: true,
                attendanceDate: true
              }
            },
            _count: {
              select: {
                attendances: true,
                payments: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        });

        // Transform the response to flatten today's attendance
        const transformedStaff = staff.map(s => ({
          ...s,
          todayAttendance: s.attendances[0] || null,
          attendances: undefined // Remove the attendances array
        }));

        result = {
          staff: transformedStaff
        };

        // Cache the result
        await redisService.setCache(cacheKey, result, StaffService.CACHE_TTL);
      }

      return result;
    } catch (error) {
      console.error('Error in getAllStaff:', error);
      throw error;
    }
  }

  /**
   * Delete a staff member
   */
  async deleteStaff(hospitalId, staffId) {
    try {
      // Check if staff exists and belongs to hospital
      const existingStaff = await prisma.staff.findFirst({
        where: {
          id: staffId,
          hospitalId
        }
      });

      if (!existingStaff) {
        throw new Error('Staff member not found');
      }

      // Hard delete the staff member
      const deletedStaff = await prisma.staff.delete({
        where: { id: staffId }
      });

      // Invalidate cache
      await this.invalidateStaffCaches(hospitalId, staffId);

      return deletedStaff;
    } catch (error) {
      console.error('Error in deleteStaff:', error);
      throw error;
    }
  }

  /**
   * Get staff payments
   */
  async getStaffPayments(hospitalId, staffId, filters = {}) {
    try {
      // Verify staff belongs to hospital
      const staff = await prisma.staff.findFirst({
        where: {
          id: staffId,
          hospitalId
        }
      });

      if (!staff) {
        throw new Error('Staff member not found');
      }

      const cacheKey = `${StaffService.CACHE_KEYS.STAFF_PAYMENTS}${staffId}:${JSON.stringify(filters)}`;
      
      // Try to get from cache first
      let payments = await redisService.getCache(cacheKey);
      
      if (!payments) {
        const whereClause = {
          staffId
        };

        // Apply filters
        if (filters.paymentType) {
          whereClause.paymentType = filters.paymentType;
        }

        if (filters.paymentMode) {
          whereClause.paymentMode = filters.paymentMode;
        }

        if (filters.startDate || filters.endDate) {
          whereClause.paymentDate = {};
          if (filters.startDate) {
            whereClause.paymentDate.gte = new Date(filters.startDate);
          }
          if (filters.endDate) {
            whereClause.paymentDate.lte = new Date(filters.endDate);
          }
        }

        payments = await prisma.staffPayment.findMany({
          where: whereClause,
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                staffRole: true
              }
            }
          },
          orderBy: {
            paymentDate: 'desc'
          }
        });

        // Cache the result
        await redisService.setCache(cacheKey, payments, StaffService.CACHE_TTL);
      }

      return payments;
    } catch (error) {
      console.error('Error in getStaffPayments:', error);
      throw error;
    }
  }

  /**
   * Helper method to invalidate staff-related caches
   */
  async invalidateStaffCaches(hospitalId, staffId = null) {
    try {
      const promises = [
        redisService.deleteByPattern(`${StaffService.CACHE_KEYS.STAFF_LIST}${hospitalId}*`)
      ];

      if (staffId) {
        promises.push(
          redisService.invalidateCache(`${StaffService.CACHE_KEYS.STAFF_DETAILS}${staffId}`),
          redisService.deleteByPattern(`${StaffService.CACHE_KEYS.STAFF_PAYMENTS}${staffId}*`)
        );
      }

      await Promise.all(promises);
    } catch (error) {
      console.error('Error invalidating staff caches:', error);
      // Don't throw error for cache invalidation failures
    }
  }
}

module.exports = new StaffService();
