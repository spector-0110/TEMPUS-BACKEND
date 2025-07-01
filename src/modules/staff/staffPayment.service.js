const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');

class StaffPaymentService {
  
  // Cache keys
  static CACHE_KEYS = {
    STAFF_PAYMENTS: 'staff:payments:',
    PAYMENT_DETAILS: 'payment:details:'
  };

  static CACHE_TTL = 300; // 5 minutes

  /**
   * Create a new staff payment
   */
  async createStaffPayment(hospitalId, staffId, paymentData) {
    try {
      // Data is already validated in controller
      const validatedData = paymentData;

      // Verify staff exists and belongs to hospital
      const staff = await prisma.staff.findFirst({
        where: {
          id: staffId,
          hospitalId,
          isActive: true
        }
      });

      if (!staff) {
        throw new Error('Staff member not found or inactive');
      }

      // Create payment record
      const payment = await prisma.staffPayment.create({
        data: {
          ...validatedData,
          staffId
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffRole: true,
              salaryType: true,
              salaryAmount: true
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidatePaymentCaches(staffId);

      return payment;
    } catch (error) {
      console.error('Error in createStaffPayment:', error);
      throw error;
    }
  }

  /**
   * Get all payments for a staff member with pagination
   */
  async getStaffPayments(hospitalId, staffId, filters = {}, page = 1, limit = 10) {
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

      const cacheKey = `${StaffPaymentService.CACHE_KEYS.STAFF_PAYMENTS}${staffId}:${JSON.stringify(filters)}:${page}:${limit}`;
      
      // Try to get from cache first
      let result = await redisService.getCache(cacheKey);
      
      if (!result) {
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

        if (filters.fromDate || filters.toDate) {
          whereClause.paymentDate = {};
          if (filters.fromDate) {
            whereClause.paymentDate.gte = new Date(filters.fromDate);
          }
          if (filters.toDate) {
            whereClause.paymentDate.lte = new Date(filters.toDate);
          }
        }

        // Calculate skip for pagination
        const skip = (page - 1) * limit;

        // Get total count
        const totalCount = await prisma.staffPayment.count({
          where: whereClause
        });

        // Get payments with pagination
        const payments = await prisma.staffPayment.findMany({
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
          },
          skip,
          take: limit
        });

        result = {
          payments,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNext: page * limit < totalCount,
            hasPrev: page > 1
          }
        };

        // Cache the result
        await redisService.setCache(cacheKey, result, StaffPaymentService.CACHE_TTL);
      }

      return result;
    } catch (error) {
      console.error('Error in getStaffPayments:', error);
      throw error;
    }
  }

  /**
   * Get payment details by payment ID
   */
  async getPaymentDetails(hospitalId, paymentId) {
    try {
      const cacheKey = `${StaffPaymentService.CACHE_KEYS.PAYMENT_DETAILS}${paymentId}`;
      
      // Try to get from cache first
      let payment = await redisService.getCache(cacheKey);
      
      if (!payment) {
        payment = await prisma.staffPayment.findFirst({
          where: {
            id: paymentId,
            staff: {
              hospitalId
            }
          },
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                staffRole: true,
                salaryType: true,
                salaryAmount: true,
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

        if (!payment) {
          throw new Error('Payment not found');
        }

        // Cache the result
        await redisService.setCache(cacheKey, payment, StaffPaymentService.CACHE_TTL);
      }

      return payment;
    } catch (error) {
      console.error('Error in getPaymentDetails:', error);
      throw error;
    }
  }

  /**
   * Delete a payment record
   */
  async deleteStaffPayment(hospitalId, paymentId) {
    try {
      // Verify payment exists and belongs to hospital
      const payment = await prisma.staffPayment.findFirst({
        where: {
          id: paymentId,
          staff: {
            hospitalId
          }
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      // Delete the payment
      const deletedPayment = await prisma.staffPayment.delete({
        where: { id: paymentId }
      });

      // Invalidate cache
      await this.invalidatePaymentCaches(payment.staffId, paymentId);

      return deletedPayment;
    } catch (error) {
      console.error('Error in deletePayment:', error);
      throw error;
    }
  }

  /**
   * Update staff payment (limited fields only)
   */
  async updateStaffPayment(hospitalId, paymentId, updateData) {
    try {
      // Data is already validated in controller
      const validatedData = updateData;

      // Verify payment exists and belongs to hospital
      const existingPayment = await prisma.staffPayment.findFirst({
        where: {
          id: paymentId,
          staff: {
            hospitalId
          }
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!existingPayment) {
        throw new Error('Payment not found');
      }

      // Update the payment
      const updatedPayment = await prisma.staffPayment.update({
        where: { id: paymentId },
        data: validatedData,
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffRole: true,
              salaryType: true,
              salaryAmount: true
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidatePaymentCaches(existingPayment.staffId, paymentId);

      return updatedPayment;
    } catch (error) {
      console.error('Error in updateStaffPayment:', error);
      throw error;
    }
  }

  /**
   * Get payment summary for a staff member
   */
  async getPaymentSummary(hospitalId, staffId, filters = {}) {
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
      if (filters.startDate || filters.endDate) {
        whereClause.paymentDate = {};
        if (filters.startDate) {
          whereClause.paymentDate.gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          whereClause.paymentDate.lte = new Date(filters.endDate);
        }
      }

      // Get aggregated payment data
      const paymentSummary = await prisma.staffPayment.groupBy({
        by: ['paymentType'],
        where: whereClause,
        _sum: {
          amount: true
        },
        _count: {
          id: true
        }
      });

      // Get total amount
      const totalPayments = await prisma.staffPayment.aggregate({
        where: whereClause,
        _sum: {
          amount: true
        },
        _count: {
          id: true
        }
      });

      return {
        totalAmount: totalPayments._sum.amount || 0,
        totalCount: totalPayments._count.id || 0,
        byType: paymentSummary.map(item => ({
          paymentType: item.paymentType,
          amount: item._sum.amount || 0,
          count: item._count.id || 0
        }))
      };
    } catch (error) {
      console.error('Error in getPaymentSummary:', error);
      throw error;
    }
  }

  /**
   * Get payment statistics for hospital
   */
  async getHospitalPaymentStats(hospitalId, filters = {}) {
    try {
      const whereClause = {
        staff: {
          hospitalId
        }
      };

      // Apply date filters
      if (filters.startDate || filters.endDate) {
        whereClause.paymentDate = {};
        if (filters.startDate) {
          whereClause.paymentDate.gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          whereClause.paymentDate.lte = new Date(filters.endDate);
        }
      }

      // Get aggregated data by payment type
      const paymentsByType = await prisma.staffPayment.groupBy({
        by: ['paymentType'],
        where: whereClause,
        _sum: {
          amount: true
        },
        _count: {
          id: true
        }
      });

      // Get aggregated data by payment mode
      const paymentsByMode = await prisma.staffPayment.groupBy({
        by: ['paymentMode'],
        where: whereClause,
        _sum: {
          amount: true
        },
        _count: {
          id: true
        }
      });

      // Get overall totals
      const totalStats = await prisma.staffPayment.aggregate({
        where: whereClause,
        _sum: {
          amount: true
        },
        _count: {
          id: true
        }
      });

      return {
        total: {
          amount: totalStats._sum.amount || 0,
          count: totalStats._count.id || 0
        },
        byType: paymentsByType.map(item => ({
          paymentType: item.paymentType,
          amount: item._sum.amount || 0,
          count: item._count.id || 0
        })),
        byMode: paymentsByMode.map(item => ({
          paymentMode: item.paymentMode,
          amount: item._sum.amount || 0,
          count: item._count.id || 0
        }))
      };
    } catch (error) {
      console.error('Error in getHospitalPaymentStats:', error);
      throw error;
    }
  }

  /**
   * Update staff payment (limited fields only)
   */
  async updateStaffPayment(hospitalId, paymentId, updateData) {
    try {
      // Data is already validated in controller
      const validatedData = updateData;

      // Verify payment exists and belongs to hospital
      const existingPayment = await prisma.staffPayment.findFirst({
        where: {
          id: paymentId,
          staff: {
            hospitalId
          }
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              hospitalId: true
            }
          }
        }
      });

      if (!existingPayment) {
        throw new Error('Payment not found');
      }

      // Update payment
      const updatedPayment = await prisma.staffPayment.update({
        where: { id: paymentId },
        data: validatedData,
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffRole: true,
              salaryType: true,
              salaryAmount: true
            }
          }
        }
      });

      // Invalidate cache
      await this.invalidatePaymentCaches(existingPayment.staffId, paymentId);

      return updatedPayment;
    } catch (error) {
      console.error('Error in updateStaffPayment:', error);
      throw error;
    }
  }

  /**
   * Helper method to invalidate payment-related caches
   */
  async invalidatePaymentCaches(staffId, paymentId = null) {
    try {
      const promises = [
        redisService.deleteByPattern(`${StaffPaymentService.CACHE_KEYS.STAFF_PAYMENTS}${staffId}*`)
      ];

      if (paymentId) {
        promises.push(
          redisService.invalidateCache(`${StaffPaymentService.CACHE_KEYS.PAYMENT_DETAILS}${paymentId}`)
        );
      }

      await Promise.all(promises);
    } catch (error) {
      console.error('Error invalidating payment caches:', error);
      // Don't throw error for cache invalidation failures
    }
  }
}

module.exports = new StaffPaymentService();
