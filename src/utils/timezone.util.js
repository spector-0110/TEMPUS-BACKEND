/**
 * Timezone utility for handling UTC and IST (Indian Standard Time) conversions
 * IST is UTC+5:30
 * 
 * Usage:
 * - Database stores only UTC
 * - Backend sends IST to frontend and UTC to database
 * - Convert IST to UTC before storing in database
 * - Convert UTC to IST before sending to frontend
 */

const IST_OFFSET_HOURS = 5;
const IST_OFFSET_MINUTES = 30;
const IST_OFFSET_MS = (IST_OFFSET_HOURS * 60 + IST_OFFSET_MINUTES) * 60 * 1000;

/**
 * Convert UTC date to IST
 * @param {Date|string} utcDate - UTC date (Date object or ISO string)
 * @returns {Date} IST date
 */
function utcToIst(utcDate) {
    try {
        let date;
        
        if (typeof utcDate === 'string') {
            date = new Date(utcDate);
        } else if (utcDate instanceof Date) {
            date = new Date(utcDate.getTime());
        } else {
            throw new Error('Invalid date input. Expected Date object or string.');
        }

        if (isNaN(date.getTime())) {
            throw new Error('Invalid date provided');
        }

        // Add IST offset to UTC time
        const istDate = new Date(date.getTime() + IST_OFFSET_MS);
        return istDate;
    } catch (error) {
        console.error('Error converting UTC to IST:', error.message);
        throw error;
    }
}

/**
 * Convert IST date to UTC
 * @param {Date|string} istDate - IST date (Date object or ISO string)
 * @returns {Date} UTC date
 */
function istToUtc(istDate) {
    try {
        let date;
        
        if (typeof istDate === 'string') {
            date = new Date(istDate);
        } else if (istDate instanceof Date) {
            date = new Date(istDate.getTime());
        } else {
            throw new Error('Invalid date input. Expected Date object or string.');
        }

        if (isNaN(date.getTime())) {
            throw new Error('Invalid date provided');
        }

        // Subtract IST offset from IST time to get UTC
        const utcDate = new Date(date.getTime() - IST_OFFSET_MS);
        return utcDate;
    } catch (error) {
        console.error('Error converting IST to UTC:', error.message);
        throw error;
    }
}

/**
 * Get current IST time
 * @returns {Date} Current date and time in IST
 */
function getCurrentIst() {
    try {
        const utcNow = new Date();
        return utcToIst(utcNow);
    } catch (error) {
        console.error('Error getting current IST:', error.message);
        throw error;
    }
}

/**
 * Get current UTC time
 * @returns {Date} Current date and time in UTC
 */
function getCurrentUtc() {
    return new Date();
}

/**
 * Convert a string date to IST
 * @param {string} dateString - Date string in any valid format
 * @param {boolean} assumeUtc - If true, assumes input is UTC. If false, converts from IST to IST (formatting only)
 * @returns {Date} Date in IST
 */
function stringDateToIst(dateString, assumeUtc = true) {
    try {
        if (typeof dateString !== 'string') {
            throw new Error('Input must be a string');
        }

        const date = new Date(dateString);
        
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date string provided');
        }

        if (assumeUtc) {
            // If the input is assumed to be UTC, convert to IST
            return utcToIst(date);
        } else {
            // If the input is already in IST, just return as Date object
            return date;
        }
    } catch (error) {
        console.error('Error converting string date to IST:', error.message);
        throw error;
    }
}

/**
 * Format date for database storage (always UTC)
 * @param {Date|string} date - Date to format for database
 * @returns {Date} UTC date for database storage
 */
function formatForDatabase(date) {
    try {
        let inputDate;
        
        if (typeof date === 'string') {
            inputDate = new Date(date);
        } else if (date instanceof Date) {
            inputDate = date;
        } else {
            throw new Error('Invalid date input. Expected Date object or string.');
        }

        if (isNaN(inputDate.getTime())) {
            throw new Error('Invalid date provided');
        }

        // If this is an IST date being stored, convert to UTC
        // Note: You might need to adjust this logic based on your frontend date handling
        return inputDate; // Assuming the input is already in the correct timezone
    } catch (error) {
        console.error('Error formatting date for database:', error.message);
        throw error;
    }
}

/**
 * Format date for frontend response (always IST)
 * @param {Date|string} utcDate - UTC date from database
 * @returns {Date} IST date for frontend
 */
function formatForFrontend(utcDate) {
    try {
        return utcToIst(utcDate);
    } catch (error) {
        console.error('Error formatting date for frontend:', error.message);
        throw error;
    }
}

/**
 * Get IST date string in ISO format
 * @param {Date} istDate - IST date
 * @returns {string} ISO string representation
 */
function getIstISOString(istDate) {
    try {
        if (!(istDate instanceof Date)) {
            throw new Error('Input must be a Date object');
        }
        
        if (isNaN(istDate.getTime())) {
            throw new Error('Invalid date provided');
        }

        return istDate.toISOString();
    } catch (error) {
        console.error('Error getting IST ISO string:', error.message);
        throw error;
    }
}

/**
 * Get UTC date string in ISO format
 * @param {Date} utcDate - UTC date
 * @returns {string} ISO string representation
 */
function getUtcISOString(utcDate) {
    try {
        if (!(utcDate instanceof Date)) {
            throw new Error('Input must be a Date object');
        }
        
        if (isNaN(utcDate.getTime())) {
            throw new Error('Invalid date provided');
        }

        return utcDate.toISOString();
    } catch (error) {
        console.error('Error getting UTC ISO string:', error.message);
        throw error;
    }
}

/**
 * Check if a date is valid
 * @param {Date|string} date - Date to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidDate(date) {
    try {
        let testDate;
        
        if (typeof date === 'string') {
            testDate = new Date(date);
        } else if (date instanceof Date) {
            testDate = date;
        } else {
            return false;
        }

        return !isNaN(testDate.getTime());
    } catch (error) {
        return false;
    }
}

module.exports = {
    utcToIst,
    istToUtc,
    getCurrentIst,
    getCurrentUtc,
    stringDateToIst,
    formatForDatabase,
    formatForFrontend,
    getIstISOString,
    getUtcISOString,
    isValidDate,
    
    // Constants for reference
    IST_OFFSET_HOURS,
    IST_OFFSET_MINUTES,
    IST_OFFSET_MS
};