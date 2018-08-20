
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

var schedule;
var isLetterDay = /([ABCDEF])\s\(US\)\s(\d)-(\d)-(\d)/g;

fs.readFile('schedule.json', 'UTF8', function(err, data) {
	if (err) throw err; 	// temp debug
	schedule = JSON.parse(data);

	var server = app.listen(8080, function() {
		console.log('Letter Day server listening on port %d', server.address().port);
	});
});

// given moment date, determine letter day and class rotation for that day, if any
function getLetterDayByDate(date, callback) {
	// call veracross API
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, data) {
		if (err) throw err;	// temp, debug

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
					if (evDate.isSame(date, 'day')) {
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
			callback({
				letter: letter,
				rotation: rotation
			});
		} else {
			callback(undefined);
		}
	});
}

// get today's letter and rotation info
app.get('/letterToday', function(req, res) {
	getLetterDayByDate(moment(), function(data) {
		res.send(data);
	});
});

// get letter / rotation info for a given date
app.post('/letterByDate', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			getLetterDayByDate(d, function(data) {
				res.send(data);
			});
		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});

// get all schedule info for a given date, if any
function infoByDate(date, callback) {
	// reset date to start of day (12am)
	date = date.startOf('day');

	// attempt to get letter day info for this day
	getLetterDayByDate(date, function(data) {
		// if successfully found letter info
		if (data) {
			// callback on letter / rotation / filled-out schedule
			callback({
				letter: data.letter,
				rotation: data.rotation,
				schedule: fillOutSkeletonSchedule(date, data.rotation)
			});
		} else {
			// callback on just skeleton with dates filled out
			callback({
				schedule: fillOutSkeletonSchedule(date, undefined)
			});
		}
	});
}

// get info about today's schedule
app.get('/infoToday', function(req, res) {
	// get schedule info for today
	infoByDate(moment(), function(data) {
		res.send(data);
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
			infoByDate(d, function(data) {
				res.send(data);
			});
		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});

// get all letter and rotation info for a full week
function getLetterDaysInWeek(date, callback) {
	var weekDays = [], count = 0;

	// get week's start and end date
	var weekStart = date.clone().startOf('week');
	var weekEnd = date.clone().endOf('week');

	// call ical for calendar data
	cal.fromURL(creds.schoolEventsCalendar, {}, function(err, data) {
		if (err) throw err; // temp, debug

		// iterate over events
		for (var k in data) {
			if (data.hasOwnProperty(k)) {
				var ev = data[k];

				var match = isLetterDay.exec(ev.summary);

				// if contains info indicating upper school letter day
				if (match) {
					var evDate = moment(ev.start);

					// if event date same as target date
					if (evDate.isBetween(weekStart, weekEnd)) {

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

		callback(weekDays);
	});
}

// get letter / rotation info for a full week
app.post('/letterByWeek', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			getLetterDaysInWeek(d, function(data) {
				res.send(data);
			});
		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});

// get all possible schedule info for a full week
app.post('/infoByWeek', function(req, res) {
	if (req.body.date) {
		var d = moment(req.body.date);

		// if valid date
		if (d.isValid()) {
			// get letter info for full week
			getLetterDaysInWeek(d, function(data) {
				// iterate over each day with letter data
				for (var i = 0; i < data.length; i++) {
					// fill out weekday schedule relative to this date / rotation
					data[i].schedule = fillOutSkeletonSchedule(data[i].date, data[i].rotation);
				}

				res.send(data);
			});

		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});

// get the events occurring at a given time on a given day
function getEventsByTime(datetime, callback) {
	// get letter day / rotation info
	getLetterDayByDate(datetime, function(data) {
		if (data) {
			// fill out full schedule for this date
			var allEvents = fillOutSkeletonSchedule(datetime, data.rotation);
			var currentEvents = [];

			// filter out events that aren't happening at given datetime
			for (var i = 0; i < allEvents.length; i++) {
				if (datetime.isBetween(allEvents[i].start, allEvents[i].end) || datetime.isSame(allEvents[i].start)) {
					currentEvents.push(allEvents[i]);
				}
			}

			// send back filled out event data
			callback(currentEvents);
		} else {
			callback(undefined);
		}
	});
}

// get any events happening at the moment
app.get('/eventsRightNow', function(req, res) {
	// get any events scheduled to be happening now
	getEventsByTime(moment(), function(data) {
		res.send(data);
	});
});

// get any events happening at a given datetime
app.post('/eventsByTime', function(req, res) {
	if (req.body.date) {
		// attempt to parse datetime
		var d = moment(req.body.date);

		// if valid datetime
		if (d.isValid()) {
			getEventsByTime(d, function(data) {
				res.send(data);
			});
		} else {
			res.send(undefined);
		}
	} else {
		res.send(undefined);
	}
});

// fill out the skeleton schedule for a given weekday date, with a given rotation
function fillOutSkeletonSchedule(date, rotation) {
	var skeleton = schedule.weekDays[date.weekday()];
	var events = [];

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