
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

fs.readFile('testschedule.json', 'UTF8', function(err, data) {
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

				var match = isLetterDay.exec(ev.summary);

				// if contains info indicating upper school letter day
				if (match) {
					var evDate = moment(ev.start);

					// if event date same as target date
					if (evDate.isSame(date, 'day')) {
						// extract regex match data
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
		getLetterDayByDate(d, function(data) {
			res.send(data);
		});
	} else {
		res.send(undefined);
	}
});

// get all schedule info for a given date, if any
function infoByDate(date, callback) {
	// reset date to start of day (12am)
	date = date.startOf('day');

	// start constructing all info for given day
	var dayInfo = {
		schedule: []
	};

	// get schedule skeleton for this weekday
	var tempSched = schedule.weekDays[date.weekday()];

	// if schedule exists for this day
	if (tempSched) {
		// make copy of events
		tempSched = tempSched.slice();


		// attempt to get letter day info for this day
		getLetterDayByDate(date, function(data) {
			// record letter data in response object
			if (data) {
				dayInfo.letter = data.letter;
				dayInfo.rotation = data.rotation;
			}

			var r = 0;

			// for each event in the schedule that day
			for (var i = 0; i < tempSched.length; i++) {
				var ev = tempSched[i];

				// if class period, attempt to classify using rotation
				if (ev.block && dayInfo.rotation && ev.block > 0) {
					ev.period = dayInfo.rotation[ev.block - 1];
				}

				// convert event times relative to requested date
				ev.start = date.clone().add(ev.start, 'minutes');
				ev.end = date.clone().add(ev.end, 'minutes');

				// prevent extended blocks for non-extended periods from getting added to day's schedule
				if (!ev.isExtended || schedule.extendedPeriods.indexOf(parseInt(ev.period, 10)) != -1) {
					dayInfo.schedule.push(ev);
				}
			}

			callback(dayInfo);
		});
	} else {
		callback(undefined);
	}
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

		// if successfully parsed date
		if (d) {
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

		// if successfully parsed date
		if (d) {
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

		// if successfully parsed date
		if (d) {
			// get letter info for full week
			getLetterDaysInWeek(d, function(data) {
				// iterate over each day with letter data
				for (var i = 0; i < data.length; i++) {
					// get schedule for this weekday
					var events = schedule.weekDays[data[i].date.weekday()];
					data[i].schedule = [];

					// format weekday events
					for (var j = 0; j < events.length; j++) {
						var ev = events[j];
						var day = data[i].date;

						// convert start and end times relative to weekdate
						ev.start = day.clone().startOf('day').add(ev.start, 'minutes');
						ev.end = day.clone().startOf('day').add(ev.end, 'minutes')

						// determine period if class block
						if (ev.block && data[i].rotation && ev.block > 0) {
							ev.period = data[i].rotation[ev.block - 1];
						}

						// add all events / barring extended blocks for non-extended periods
						if (!ev.isExtended || schedule.extendedPeriods.indexOf(parseInt(ev.period, 10)) != -1) {
							data[i].schedule.push(ev);
						}
					}
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
	// attempt to pull schedule for today, if exists
	var sched = schedule.weekDays[datetime.weekday()];

	// if schedule exists
	if (sched) {
		// copy events
		sched = sched.slice();

		// get letter day / rotation info
		getLetterDayByDate(datetime, function(data) {
			if (data) {
				var response = {
					events: []
				};

				// iterate events
				for (var i = 0; i < sched.length; i++) {
					var ev = sched[i];

					// convert start and end times relative to current date
					ev.start = datetime.clone().startOf('day').add(ev.start, 'minutes');
					ev.end = datetime.clone().startOf('day').add(ev.end, 'minutes');

					// determine period if class block
					if (ev.block && data.rotation && ev.block > 0) {
						ev.period = data.rotation[ev.block - 1];
					}

					// if this event currently happening (and not an extended block for a non-extended period)
					if ((datetime.isBetween(ev.start, ev.end) || datetime.isSame(ev.start) || datetime.isSame(ev.end)) && !(ev.isExtended && schedule.extendedPeriods.indexOf(parseInt(ev.period, 10)) == -1)) {
						response.events.push(ev);
					}
				}

				callback(response);
			} else {
				callback(undefined);
			}
		});
	} else {
		callback(undefined);
	}
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
	if (req.body.datetime) {
		// attempt to parse datetime
		var d = moment(req.body.datetime);

		// if successfully parsed datetime
		if (d) {
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