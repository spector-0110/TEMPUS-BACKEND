const Razorpay = require("razorpay");

let razorpayInstance = null;
let isInitialized = false;

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    // Check environment variables
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('Razorpay configuration error:', {
        keyIdPresent: !!process.env.RAZORPAY_KEY_ID,
        keySecretPresent: !!process.env.RAZORPAY_KEY_SECRET,
        timestamp: new Date().toISOString()
      });
      throw new Error('Razorpay credentials are not properly configured in environment variables');
    }
    
    try {
      razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
      
      // Validate the instance and its methods
      if (!razorpayInstance?.orders?.create || !razorpayInstance?.payments?.fetch) {
        throw new Error('Razorpay instance is missing required methods');
      }
      
      // Verify instance is working by checking basic connectivity
      razorpayInstance.orders.all()
        .then(() => {
          if (!isInitialized) {
            console.info("Razorpay instance initialized and verified successfully", {
              timestamp: new Date().toISOString(),
            });
            isInitialized = true;
          }
        })
        .catch(error => {
          console.error('Razorpay connectivity check failed:', {
            error: error.message,
            timestamp: new Date().toISOString()
          });
          // Don't throw here, just log the error as this is a background check
        });
    } catch (error) {
      console.error('Failed to initialize Razorpay:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw new Error(`Failed to initialize Razorpay: ${error.message}`);
    }
  }
  
  return razorpayInstance;
};

module.exports = getRazorpayInstance;