const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { getCurrentIst } = require('../../utils/timezone.util');

class AttendanceService {
  
  // Cache keys
  static CACHE_KEYS = {
    STAFF_ATTENDANCE: 'attendance:staff:',
    ATTENDANCE_DETAILS: 'attendance:details:',
    STAFF_LIST: 'staff:list:',
    STAFF_DETAILS: 'staff:details:',
    STAFF_PAYMENTS: 'staff:payments:'
  };

  static CACHE_TTL = 300; // 5 minutes

  /**
   * Mark or update staff attendance (upsert operation)
   */
  async markAttendance(hospitalId, attendanceData) {
    try {
      // Data is already validated in controller
      const validatedData = attendanceData;

      // Use upsert to create or update attendance
      const attendance = await prisma.attendance.upsert({
        where: {
          staffId_attendanceDate: {
            staffId: validatedData.staffId,
            attendanceDate:validatedData.attendanceDate
          }
        },
        update: {
          status: validatedData.status
        },
        create: {
          staffId: validatedData.staffId,
          attendanceDate: validatedData.attendanceDate,
          status: validatedData.status
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffRole: true,
              hospital: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidateAttendanceCaches(validatedData.staffId,hospitalId);

      return attendance;
    } catch (error) {
      console.error('Error in markAttendance:', error);
      throw error;
    }
  }

  /**
   * Get attendance for a staff member with optional date range
   */
  async getStaffAttendance(hospitalId, staffId, filters = {}) {
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

      const cacheKey = `${AttendanceService.CACHE_KEYS.STAFF_ATTENDANCE}${staffId}:${JSON.stringify(filters)}`;
      
      // Try to get from cache first
      let attendance = await redisService.getCache(cacheKey);
      
      if (!attendance) {
        const whereClause = {
          staffId
        };

        // Apply date filters
        if (filters.fromDate || filters.toDate) {
          whereClause.attendanceDate = {};
          if (filters.fromDate) {
            whereClause.attendanceDate.gte = new Date(filters.fromDate);
          }
          if (filters.toDate) {
            whereClause.attendanceDate.lte = new Date(filters.toDate);
          }
        } else {
          // Default to current month if no date range provided
          const nowIST = getCurrentIst();
          const currentMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
          const currentMonthEnd = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 0, 23, 59, 59, 999);
          
          whereClause.attendanceDate = {
            gte: currentMonthStart,
            lte: currentMonthEnd
          };
        }

        // Apply status filter
        if (filters.status) {
          whereClause.status = filters.status;
        }

        attendance = await prisma.attendance.findMany({
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
            attendanceDate: 'desc'
          }
        });

        // Cache the result
        await redisService.setCache(cacheKey, attendance, AttendanceService.CACHE_TTL);
      }

      return attendance;
    } catch (error) {
      console.error('Error in getStaffAttendance:', error);
      throw error;
    }
  }

  /**
   * Get attendance summary for a staff member
   */
  async getAttendanceSummary(hospitalId, staffId, filters = {}) {
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

      const whereClause = {
        staffId
      };

      // Apply date filters
      if (filters.fromDate || filters.toDate) {
        whereClause.attendanceDate = {};
        if (filters.fromDate) {
          whereClause.attendanceDate.gte = new Date(filters.fromDate);
        }
        if (filters.toDate) {
          whereClause.attendanceDate.lte = new Date(filters.toDate);
        }
      } else {
        // Default to current month
        const nowIST = getCurrentIst();
        const currentMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
        const currentMonthEnd = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 0, 23, 59, 59, 999);
        
        whereClause.attendanceDate = {
          gte: currentMonthStart,
          lte: currentMonthEnd
        };
      }

      // Get aggregated attendance data
      const attendanceSummary = await prisma.attendance.groupBy({
        by: ['status'],
        where: whereClause,
        _count: {
          id: true
        }
      });

      // Get total count
      const totalDays = await prisma.attendance.count({
        where: whereClause
      });

      return {
        totalDays,
        byStatus: attendanceSummary.map(item => ({
          status: item.status,
          count: item._count.id
        }))
      };
    } catch (error) {
      console.error('Error in getAttendanceSummary:', error);
      throw error;
    }
  }

  /**
   * Get attendance for all staff in a hospital
   */
  async getHospitalAttendance(hospitalId, filters = {}) {
    try {
      const whereClause = {
        staff: {
          hospitalId
        }
      };

      // Apply date filters
      if (filters.fromDate || filters.toDate) {
        whereClause.attendanceDate = {};
        if (filters.fromDate) {
          whereClause.attendanceDate.gte = new Date(filters.fromDate);
        }
        if (filters.toDate) {
          whereClause.attendanceDate.lte = new Date(filters.toDate);
        }
      } else {
        // Default to current date
        const nowIST = getCurrentIst();
        const today = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
        whereClause.attendanceDate = {
          gte: today,
          lte: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
        };
      }

      // Apply status filter
      if (filters.status) {
        whereClause.status = filters.status;
      }

      // Apply staff role filter
      if (filters.staffRole) {
        whereClause.staff.staffRole = filters.staffRole;
      }

      const attendance = await prisma.attendance.findMany({
        where: whereClause,
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffRole: true,
              isActive: true,
              mobileNumber: true,
            }
          }
        },
        orderBy: [
          { attendanceDate: 'desc' },
          { staff: { name: 'asc' } }
        ]
      });

      return attendance;
    } catch (error) {
      console.error('Error in getHospitalAttendance:', error);
      throw error;
    }
  }

  /**
   * Delete attendance record
   */
  async deleteAttendance(hospitalId, staffId, attendanceDate) {
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

      // Convert attendance date to just date (remove time component)
      const dateOnly = new Date(attendanceDate);
      dateOnly.setUTCHours(0, 0, 0, 0);

      // Find and delete attendance
      const deletedAttendance = await prisma.attendance.delete({
        where: {
          staffId_attendanceDate: {
            staffId: staffId,
            attendanceDate: dateOnly
          }
        }
      });

      // Invalidate cache
      await this.invalidateAttendanceCaches(staffId,hospitalId);

      return deletedAttendance;
    } catch (error) {
      if (error.code === 'P2025') {
        throw new Error('Attendance record not found');
      }
      console.error('Error in deleteAttendance:', error);
      throw error;
    }
  }

  /**
   * Helper method to invalidate attendance-related caches
   */
  async invalidateAttendanceCaches(staffId, hospitalId) {
    try {
      // Get today's date for cache invalidation
      const today = getCurrentIst().toISOString().split('T')[0];
      
      const promises = [
        // Invalidate attendance-specific caches
        redisService.deleteByPattern(`${AttendanceService.CACHE_KEYS.STAFF_ATTENDANCE}${staffId}*`),
        redisService.deleteByPattern(`${AttendanceService.CACHE_KEYS.ATTENDANCE_DETAILS}${staffId}*`),
        // Invalidate staff list cache as it contains attendance info
        redisService.deleteByPattern(`${AttendanceService.CACHE_KEYS.STAFF_LIST}${hospitalId}*`),
        // Specifically invalidate today's cache
        redisService.deleteByPattern(`${AttendanceService.CACHE_KEYS.STAFF_LIST}${hospitalId}:${today}`)
      ];

      await Promise.all(promises);
    } catch (error) {
      console.error('Error invalidating attendance caches:', error);
      // Don't throw error for cache invalidation failures
    }
  }
}

module.exports = new AttendanceService();
