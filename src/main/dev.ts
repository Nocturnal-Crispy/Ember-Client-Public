/**
 * Development configuration
 * This file is only included in development builds
 */

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export { isDev };
