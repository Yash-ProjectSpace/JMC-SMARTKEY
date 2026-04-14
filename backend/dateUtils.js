// backend/dateUtils.js

// Variable to cache the holiday data so we don't spam the API every time
let holidaysCache = null;

// 1. Fetch Japanese Holidays from the API
async function getHolidays() {
  if (holidaysCache) return holidaysCache;
  
  try {
    const response = await fetch('https://holidays-jp.github.io/api/v1/date.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    holidaysCache = await response.json(); // Looks like: { "2026-01-01": "元日", ... }
    return holidaysCache;
  } catch (error) {
    console.error("❌ Failed to fetch holiday data:", error);
    return {}; // Return empty object so the system doesn't crash if the API is down
  }
}

// 2. Check if a specific date is a Weekend OR a Holiday
async function isHolidayOrWeekend(dateStr) {
  const holidays = await getHolidays();
  const date = new Date(dateStr);
  const day = date.getDay();

  // 0 is Sunday, 6 is Saturday
  if (day === 0 || day === 6) return true;
  
  // Check if the date string (YYYY-MM-DD) exists in the holiday API response
  if (holidays[dateStr]) return true;

  return false;
}

// 3. Calculate "X Working Days Before" a target date (SKIPS weekends & holidays)
async function getTargetWorkingDateBefore(targetDateStr, daysBefore) {
  let currentDate = new Date(targetDateStr);
  let daysCounted = 0;

  while (daysCounted < daysBefore) {
    // Subtract 1 day
    currentDate.setDate(currentDate.getDate() - 1);
    const dateString = currentDate.toISOString().split('T')[0];
    
    // If it's NOT a holiday or weekend, count it as a valid working day
    const skip = await isHolidayOrWeekend(dateString);
    if (!skip) {
      daysCounted++;
    }
  }

  return currentDate.toISOString().split('T')[0];
}

// 4. Get a list of all valid working days for the next 14 days (For Friday announcements)
async function getNextTwoWeeksWorkingDays() {
  const dates = [];
  let currentDate = new Date(); // Starts from Today
  
  // Look ahead 14 days
  for (let i = 1; i <= 14; i++) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dateString = currentDate.toISOString().split('T')[0];
    
    const skip = await isHolidayOrWeekend(dateString);
    if (!skip) {
      dates.push(dateString);
    }
  }
  return dates;
}

// Export these functions so server.js can use them
module.exports = {
  getHolidays,
  isHolidayOrWeekend,
  getTargetWorkingDateBefore,
  getNextTwoWeeksWorkingDays
};