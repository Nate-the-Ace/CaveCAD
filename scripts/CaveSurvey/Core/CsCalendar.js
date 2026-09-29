// CsCalendar.js -- the date arithmetic behind the Start date picker.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI.
// This bridge has no QCalendarWidget, QDate or QDateEdit, so the
// Expedition Planner draws its calendar from plain buttons and asks
// this file which day each button is.
//
// EVERY DAY IS COMPUTED THROUGH Date.UTC, so a time zone or a DST jump
// can never move a date by one. Only today() reads the local clock,
// and it is kept apart so the tests can hand the pieces a fixed today.
//
// Dates are always written yyyy-mm-dd; months are 1-12 throughout.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsCalendar = {};

/** Weeks start on Sunday. */
CsCalendar.WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

CsCalendar.MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

/** The picker's year range. */
CsCalendar.YEAR_MIN = 1970;
CsCalendar.YEAR_MAX = 2100;

var csCalTwo = function(n) {
    return (n < 10 ? "0" : "") + n;
};

/** Zero-padded "yyyy-mm-dd". */
CsCalendar.iso = function(year, month, day) {
    return String(year) + "-" + csCalTwo(month) + "-" + csCalTwo(day);
};

/**
 * "yyyy-mm-dd" (surrounding space allowed) to {year, month, day}, or
 * null for anything else, including a date that does not exist.
 */
CsCalendar.parse = function(text) {
    if (text === null || text === undefined) { return null; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).replace(/^\s+|\s+$/g, ""));
    if (m === null) { return null; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1) { return null; }
    var t = new Date(Date.UTC(y, mo - 1, d));
    // Date.UTC reads years 0-99 as 1900+; a real 4-digit year is fine.
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
        return null;
    }
    return { year: y, month: mo, day: d };
};

/** Days in a month (leap years by the Gregorian rule). */
CsCalendar.daysInMonth = function(year, month) {
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

/** {year, month} `delta` months on (negative goes back). */
CsCalendar.addMonths = function(year, month, delta) {
    var n = year * 12 + (month - 1) + delta;
    var y = Math.floor(n / 12);
    return { year: y, month: n - y * 12 + 1 };
};

/**
 * The month as 6 rows of 7 cells, Sunday first, each cell
 * {year, month, day, iso, inMonth}. Days from the months either side
 * fill the leading and trailing cells (inMonth false).
 */
CsCalendar.monthGrid = function(year, month) {
    var first = Date.UTC(year, month - 1, 1);
    var lead = new Date(first).getUTCDay();
    var start = first - lead * 86400000;
    var rows = [];
    for (var r = 0; r < 6; r++) {
        var row = [];
        for (var c = 0; c < 7; c++) {
            var t = new Date(start + (r * 7 + c) * 86400000);
            var y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate();
            row.push({ year: y, month: mo, day: d, iso: CsCalendar.iso(y, mo, d),
                inMonth: y === year && mo === month });
        }
        rows.push(row);
    }
    return rows;
};

/** A year held to the picker's range; anything not a number is the minimum. */
CsCalendar.clampYear = function(y) {
    var n = Number(y);
    if (!isFinite(n)) { return CsCalendar.YEAR_MIN; }
    n = Math.round(n);
    return Math.max(CsCalendar.YEAR_MIN, Math.min(CsCalendar.YEAR_MAX, n));
};

/** Today by the LOCAL clock, {year, month, day}. */
CsCalendar.today = function() {
    var d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};
