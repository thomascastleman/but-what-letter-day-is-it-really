
var express         = require('express');
var mustacheExpress = require('mustache-express');
var bodyParser      = require('body-parser');
var moment			= require('moment');
var cal 			= require('ical');
var fs				= require('fs');
var creds			= require('./credentials.js');

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.engine('html', mustacheExpress());
app.use('/', express.static('views'));

var PORT = 8080;	// server port
var SCHEDULE_PATH = __dirname + '/schedule.json';	// path to schedule serialization
var schedule;	// daily schedule serialized in object

// regular expression to match all event summaries that detail the US rotation / letter day (including special schedules)
var letterDayRE = /Day ([ABCDEF]) \(US\) (\d)-(\d)-(\d)( \(US Special Schedule (\d)-(\d)-(\d)\))?/g;

// on start, read daily schedule from file
establishSchedule(function(err) {
	// throw error if unable to find schedule.json file -- critical
	if (err) throw new Error("Failed to read schedule serialization file: " + err.message);

	// throw error if no calendar feed given
	if (!creds.schoolEventsCalendar || creds.schoolEventsCalendar == '') {
		throw new Error("credentials.js: No Veracross ICS feed given.")
	}

	// start server to listen on specified port
	var server = app.listen(PORT, function() {
		console.log('Letter Day server listening on port %d', server.address().port);
	});
});

/*	parse event info regarding letter day, rotation, and special schedule
	status into an object */
function extractLetterInfo(event, match) {
	/*	Extract regex match data (letter and rotation periods).
		Try to use special schedule match if found, if not use regular.
		Include event date, and raw summary in data.
		If summary suggests a special schedule, make note of it. */
	return {
		date: moment(event.start).startOf('day'),
		raw: event.summary,
		letter: match[5] ? match[5].substring(1, match[5].length).replace(/[()]/g, '') : match[1],
		rotation: match[6] && match[7] && match[8] ? [match[6], match[7], match[8]] : [match[2], match[3], match[4]],
		isSpecial: event.summary.toLowerCase().includes('special')
	};
}

// given moment date, determine letter day and class rotation for that day, if any
function getLetterDayByDate(date, cb) {
	// call veracross API
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, icalEvents) {
		if (err) {
			// callback on error object
			cb(err);
		} else {
			// letter data object
			var letterData;

			// iterate over events
			for (var k in icalEvents) {
				if (icalEvents.hasOwnProperty(k)) {
					var ev = icalEvents[k];

					letterDayRE.lastIndex = 0;	// reset regex object to match from start of string
					var m = letterDayRE.exec(ev.summary);	// attempt to match event summary against regex

					// if match found, and has all necessary groups
					if (m && m.length > 8) {
						// parse start time to get date of event
						var evDate = moment(ev.start);

						// if event date same as target date
						if (evDate.isValid() && evDate.isSame(date, 'day')) {
							// parse the letter day info from event and regex match
							letterData = extractLetterInfo(ev, m);

							// break out of loop, as we've found what we're looking for
							break;
						}
					}
				}
			}

			if (letterData) {
				// callback on resulting data, if any was found
				cb(err, letterData);
			} else {
				// callback on error
				cb("No letter day information was found for " + date.format('YYYY-MM-DD'));
			}
		}
	});
}

// get today's letter and rotation info
app.get('/letterToday', function(req, res) {
	getLetterDayByDate(moment(), function(err, data) {
		res.send({ err: err, data: data });
	});
});

// get letter / rotation info for a given date
app.post('/letterByDate', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			getLetterDayByDate(d, function(err, data) {
				res.send({ err: err, data: data });
			});
		} else {
			res.send({ err: "Invalid date parameter." });
		}
	} else {
		res.send({ err: "No date parameter given." });
	}
});

// get all schedule info for a given date, if any
function infoByDate(date, cb) {
	// reset date to start of day (12am)
	date = date.startOf('day');

	// attempt to get letter day info for this day
	getLetterDayByDate(date, function(err, data) {
		// if successfully found letter info
		if (!err) {
			// add filled-out daily schedule to data
			data.schedule = fillSched(date, data.rotation)

			// callback on letter / rotation / filled-out schedule
			cb(err, data);
		} else {
			// callback on just skeleton with dates filled out
			cb(err, {
				schedule: fillSched(date, undefined)
			});
		}
	});
}

// get info about today's schedule
app.get('/infoToday', function(req, res) {
	// get schedule info for today
	infoByDate(moment(), function(err, data) {
		res.send({ err: err, data: data });
	});
});

// get all possible schedule info for a given weekday date
app.post('/infoByDate', function(req, res) {
	if (req.body.date) {
		// parse date
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			// get schedule info for given date
			infoByDate(d, function(err, data) {
				res.send({ err: err, data: data });
			});
		} else {
			res.send({ err: "Invalid date parameter." });
		}
	} else {
		res.send({ err: "No date parameter given." });
	}
});

// get all letter and rotation info for a full week
function getLetterDaysInWeek(date, cb) {
	var weekDays = [], count = 0;

	// get week's start and end date
	var weekStart = date.clone().startOf('week');
	var weekEnd = date.clone().endOf('week');

	// call ical for calendar data
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, icalEvents) {
		if (err) {
			// callback on error object
			cb(err);
		} else {
			// iterate over events
			for (var k in icalEvents) {
				if (icalEvents.hasOwnProperty(k)) {
					var ev = icalEvents[k];

					letterDayRE.lastIndex = 0;	// reset regex object to match from start of string
					var m = letterDayRE.exec(ev.summary);	// check event summary for letter day info

					// if match found, with necessary groups
					if (m && m.length > 8) {
						// get event date by parsing start time
						var evDate = moment(ev.start);

						// if event date within the week
						if (evDate.isValid() && evDate.isBetween(weekStart, weekEnd)) {
							// parse letter info from event object and regex match
							var letterData = extractLetterInfo(ev, m);

							// add data to weekday list
							weekDays.push(letterData);

							// if five weekdays found, finish
							count++;
							if (count > 4) {
								break;
							}
						}
					}
				}
			}

			// callback on week of letter day info
			cb(err, weekDays);
		}
	});
}

// get letter / rotation info for a full week
app.post('/letterByWeek', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			getLetterDaysInWeek(d, function(err, data) {
				res.send({ err: err, data: data });
			});
		} else {
			res.send({ err: "Invalid date parameter." });
		}
	} else {
		res.send({ err: "No date parameter given." });
	}
});

// get all possible schedule info for a full week
app.post('/infoByWeek', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			// get letter info for full week
			getLetterDaysInWeek(d, function(err, data) {
				if (!err) {
					// iterate over each day with letter data
					for (var i = 0; i < data.length; i++) {
						// fill out weekday schedule relative to this date / rotation
						data[i].schedule = fillSched(data[i].date, data[i].rotation);
					}

					// send week's data
					res.send({ err: err, data: data });
				} else {
					// send error
					res.send({ err: err });
				}
			});
		} else {
			res.send({ err: "Invalid date parameter." });
		}
	} else {
		res.send({ err: "No date parameter given." });
	}
});

// get the events occurring at a given time on a given day
function getEventsByTime(datetime, cb) {
	// get letter day / rotation info
	getLetterDayByDate(datetime, function(err, data) {
		if (!err) {
			// fill out full schedule for this date
			var allEvents = fillSched(datetime, data.rotation);
			var currentEvents = [];

			// filter out events that aren't happening at given datetime
			for (var i = 0; i < allEvents.length; i++) {
				if (datetime.isBetween(allEvents[i].start, allEvents[i].end) || datetime.isSame(allEvents[i].start)) {
					currentEvents.push(allEvents[i]);
				}
			}

			// send back filled out event data
			cb(err, currentEvents);
		} else {
			cb(err);
		}
	});
}

// get any events happening at the moment
app.get('/eventsRightNow', function(req, res) {
	// get any events scheduled to be happening now
	getEventsByTime(moment(), function(err, data) {
		res.send({ err: err, data: data });
	});
});

// get any events happening at a given datetime
app.post('/eventsByTime', function(req, res) {
	if (req.body.date) {
		// attempt to parse datetime
		var d = moment(req.body.date);

		// if valid datetime
		if (d.isValid()) {
			getEventsByTime(d, function(err, data) {
				res.send({ err: err, data: data });
			});
		} else {
			res.send({ err: "Invalid date parameter." });
		}
	} else {
		res.send({ err: "No date parameter given." });
	}
});

// read daily schedule from file, parse as necessary
function establishSchedule(cb) {
	// read daily schedule serialization from filepath defined above
	fs.readFile(SCHEDULE_PATH, 'UTF8', function(err, data) {
		if (!err) {
			// parse JSON string into an object
			schedule = JSON.parse(data);

			// for each week day
			for (var i = 0; i < schedule.weekDays.length; i++) {
				// for each event that day
				for (var j = 0; j < schedule.weekDays[i].length; j++) {
					var ev = schedule.weekDays[i][j];

					// parse event start into object with hours and minutes as integers
					var spl = ev.start.split(':');
					ev.start = {
						hours: parseInt(spl[0], 10),
						minutes: parseInt(spl[1], 10)
					};

					// perform same formatting for event end
					spl = ev.end.split(':');
					ev.end = {
						hours: parseInt(spl[0], 10),
						minutes: parseInt(spl[1], 10)
					};
				}
			}

			// callback, as schedule is ready to be used
			cb();
		} else {
			// callback on error given by fs
			cb(err);
		}
	});
}

// fill out the skeleton schedule for a given weekday date, with a given rotation
function fillSched(date, rotation) {
	var skeleton = schedule.weekDays[date.weekday() - 1];
	var events = [];

	// if schedule info exists for this date's weekday
	if (skeleton) {
		// iterate events
		for (var i = 0; i < skeleton.length; i++) {
			var event = skeleton[i];

			// make copy of each event from skeleton with info filled in (dates relative to given date)
			var eventCopy = {
				name: event.name,
				start: date.clone().startOf('day').set({
					hours: event.start.hours,
					minutes: event.start.minutes
				}),
				end: date.clone().startOf('day').set({
					hours: event.end.hours,
					minutes: event.end.minutes
				}),
			};

			// record event extended
			if (event.isExtended) {
				eventCopy.isExtended = 1;
			}

			// determine period if class block
			if (rotation && event.block && rotation[event.block - 1]) {
				eventCopy.period = rotation[event.block - 1];
			}

			// if this event currently happening (and not an extended block for a non-extended period)
			if (!event.isExtended || schedule.extendedPeriods.indexOf(eventCopy.period) != -1) {
				events.push(eventCopy);
			}
		}
	}

	return events;
}

// redirect wildcard GETs to /letterToday
app.get('*', function(req, res) {
	res.redirect('/letterToday');
});
