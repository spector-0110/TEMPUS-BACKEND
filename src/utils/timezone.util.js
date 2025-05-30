/**
 * Timezone utility for handling Indian Standard Time (IST)
 * Since the backend is hosted in Singapore but users are in India
 */

const INDIAN_TIMEZONE = 'Asia/Kolkata';

class TimezoneUtil {
  /**
   * Get current date and time in Indian timezone
   * @returns {Date} Current date in IST
   */
  static getCurrentDateIST() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: INDIAN_TIMEZONE }));
  }

  /**
   * Convert any date to Indian timezone
   * @param {Date|string} date - Date to convert
   * @returns {Date} Date in IST
   */
  static toIST(date) {
    const inputDate = new Date(date);
    return new Date(inputDate.toLocaleString("en-US", { timeZone: INDIAN_TIMEZONE }));
  }

  /**
   * Get today's date in IST (start of day)
   * @returns {Date} Today's date at 00:00:00 IST
   */
  static getTodayIST() {
    const today = this.getCurrentDateIST();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  /**
   * Get tomorrow's date in IST (start of day)
   * @returns {Date} Tomorrow's date at 00:00:00 IST
   */
  static getTomorrowIST() {
    const tomorrow = this.getCurrentDateIST();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Get date N days from today in IST
   * @param {number} days - Number of days to add (can be negative)
   * @returns {Date} Date N days from today in IST
   */
  static getDatePlusDaysIST(days) {
    const date = this.getCurrentDateIST();
    date.setDate(date.getDate() + days);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  /**
   * Get current day of week in IST (0 = Sunday, 6 = Saturday)
   * @returns {number} Day of week
   */
  static getCurrentDayOfWeekIST() {
    return this.getCurrentDateIST().getDay();
  }

  /**
   * Get day of week for a specific date in IST
   * @param {Date|string} date - Date to get day of week for
   * @returns {number} Day of week (0 = Sunday, 6 = Saturday)
   */
  static getDayOfWeekIST(date) {
    return this.toIST(date).getDay();
  }

  /**
   * Format date in IST to ISO string
   * @param {Date|string} date - Date to format
   * @returns {string} ISO string in IST
   */
  static toISTISOString(date) {
    return this.toIST(date).toISOString();
  }

  /**
   * Format date in IST for local display
   * @param {Date|string} date - Date to format
   * @param {object} options - Formatting options
   * @returns {string} Formatted date string
   */
  static formatDateIST(date, options = {}) {
    const defaultOptions = {
      timeZone: INDIAN_TIMEZONE,
      ...options
    };
    return new Date(date).toLocaleDateString('en-IN', defaultOptions);
  }

  /**
   * Format time in IST for local display
   * @param {Date|string} date - Date/time to format
   * @param {object} options - Formatting options
   * @returns {string} Formatted time string
   */
  static formatTimeIST(date, options = {}) {
    const defaultOptions = {
      timeZone: INDIAN_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      ...options
    };
    return new Date(date).toLocaleTimeString('en-IN', defaultOptions);
  }

  /**
   * Check if a date is today in IST
   * @param {Date|string} date - Date to check
   * @returns {boolean} True if date is today in IST
   */
  static isTodayIST(date) {
    const today = this.getTodayIST();
    const checkDate = this.toIST(date);
    checkDate.setHours(0, 0, 0, 0);
    return today.getTime() === checkDate.getTime();
  }

  /**
   * Check if a date is tomorrow in IST
   * @param {Date|string} date - Date to check
   * @returns {boolean} True if date is tomorrow in IST
   */
  static isTomorrowIST(date) {
    const tomorrow = this.getTomorrowIST();
    const checkDate = this.toIST(date);
    checkDate.setHours(0, 0, 0, 0);
    return tomorrow.getTime() === checkDate.getTime();
  }

  /**
   * Get start and end of day in IST
   * @param {Date|string} date - Date to get start/end for
   * @returns {object} Object with startOfDay and endOfDay in IST
   */
  static getDayBoundariesIST(date) {
    const startOfDay = this.toIST(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = this.toIST(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    return { startOfDay, endOfDay };
  }

  /**
   * Create a date with specific time in IST
   * @param {Date|string} date - Base date
   * @param {string} timeStr - Time in HH:MM format
   * @returns {Date} Date with specified time in IST
   */
  static createDateWithTimeIST(date, timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const result = this.toIST(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  /**
   * Get time difference between server time and IST in minutes
   * @returns {number} Difference in minutes (positive if IST is ahead)
   */
  static getTimezoneOffsetMinutes() {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: INDIAN_TIMEZONE }));
    return Math.round((istTime.getTime() - now.getTime()) / (1000 * 60));
  }

  /**
   * Convert time string to IST time string
   * @param {string} timeStr - Time in HH:MM format
   * @param {Date} date - Reference date (defaults to today)
   * @returns {string} Time string in IST
   */
  static convertTimeToIST(timeStr, date = new Date()) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hours, minutes, 0, 0);
    
    const istDateTime = this.toIST(dateTime);
    return `${String(istDateTime.getHours()).padStart(2, '0')}:${String(istDateTime.getMinutes()).padStart(2, '0')}`;
  }
}

module.exports = TimezoneUtil;
