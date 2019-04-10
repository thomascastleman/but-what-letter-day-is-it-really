
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

var port = 8080;	// server port
var schedule;	// daily schedule serialized in object
var isLetterDay = /([ABCDEF])\s\(US\)\s(\d)-(\d)-(\d)/g;	// regular expression for extracting letter day info from ical response

// read daily schedule serialization from file
fs.readFile('./schedule.json', 'UTF8', function(err, data) {
	// throw error if unable to find schedule.json file -- critical
	if (err) throw new Error("Failed to read schedule.json: " + err.message);

	// parse JSON into an object
	schedule = JSON.parse(data);

	// throw error if no calendar feed given
	if (!creds.schoolEventsCalendar || creds.schoolEventsCalendar == '') {
		throw new Error("credentials.js: No Veracross ICS feed given.")
	}

	// start server to listen on specified port
	var server = app.listen(port, function() {
		console.log('Letter Day server listening on port %d', server.address().port);
	});
});

// given moment date, determine letter day and class rotation for that day, if any
function getLetterDayByDate(date, cb) {
	// call veracross API
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, data) {
		if (err) {
			// callback on error object
			cb(err);
		} else {
			var letter, rotation;

			// iterate over events
			for (var k in data) {
				if (data.hasOwnProperty(k)) {
					var ev = data[k];

					isLetterDay.lastIndex = 0;	// reset regex object to match from start of string
					var match = isLetterDay.exec(ev.summary);

					// if contains info indicating upper school letter day
					if (match) {
						var evDate = moment(ev.start);

						// if event date same as target date
						if (evDate.isValid() && evDate.isSame(date, 'day')) {
							// extract regex match data (letter and rotation periods)
							letter = match[1];
							rotation = [match[2], match[3], match[4]];
							break;
						}
					}
				}
			}

			// callback on resulting data
			if (letter && rotation) {
				cb(err, {
					letter: letter,
					rotation: rotation
				});
			} else {
				// callback on error
				cb("There is no letter day information for the requested date.");
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
			// callback on letter / rotation / filled-out schedule
			cb(err, {
				letter: data.letter,
				rotation: data.rotation,
				schedule: fillSched(date, data.rotation)
			});
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
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, data) {
		if (err) {
			// callback on error object
			cb(err);
		} else {
			// iterate over events
			for (var k in data) {
				if (data.hasOwnProperty(k)) {
					var ev = data[k];

					// check regex match against event summary
					var match = isLetterDay.exec(ev.summary);

					// if contains info indicating upper school letter day
					if (match) {
						var evDate = moment(ev.start);

						// if event date same as target date
						if (evDate.isValid() && evDate.isBetween(weekStart, weekEnd)) {

							// extract regex match data
							weekDays.push({
								date: evDate,
								letter: match[1],
								rotation: [match[2], match[3], match[4]]
							});

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

// fill out the skeleton schedule for a given weekday date, with a given rotation
function fillSched(date, rotation) {
	var skeleton = schedule.weekDays[date.weekday()];
	var events = [];

	// if schedule info exists for this date's weekday
	if (skeleton) {
		// iterate events
		for (var i = 0; i < skeleton.length; i++) {
			var event = skeleton[i];

			// make copy of each event from skeleton with info filled in (dates relative to given date)
			var eventCopy = {
				name: event.name,
				start: date.clone().startOf('day').add(event.start, 'minutes'),
				end: date.clone().startOf('day').add(event.end, 'minutes')
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