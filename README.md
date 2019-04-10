# but-what-letter-day-is-it-really
A more sustainable extension of the letter day service for managing the St. Anne's-Belfield school schedule.

**Schedule Data:** Note that this service uses an outline of the basic schedule that is *not* updated on special occasions, meaning that it will not always provide accurate results. However, in most standard cases, the schedule is consistent and data can be trusted. 

**Letter Data:** Letter and rotation data is pulled from the school's calendar, however, which *is* usually updated regularly, meaning this data should be accurate almost always.

Schedule last updated: August 2018

## Endpoints

Each response will include any error in the `err` attribute, and the actual response data in the `data` attribute.

##### POST `/letterByDate`
Get the letter day and rotation data for any given *future* date, if any exists, by posting a [moment](https://momentjs.com/)-parseable date string under the name `date`. The response object will look like:
```json
{
  "data": {
    "letter":"D",
    "rotation":["5","6","4"]
  }
}
```

Example usage: (with jQuery `$.post`)

```javascript
// get the letter data for Sep 21, 2018
$.post('... /letterByDate', { date: "2018-09-21" }, function(res) {
  if (!res.err) {
    // do something with res.data.letter or res.data.rotation
  }
});
```

---
##### GET `/letterToday`
Get today's letter day and rotation data, if any exists. Same response format as `/letterByDate`.

---
##### POST `/infoByDate`
Get all schedule info for any given *future* date by posting a date string under the name `date`. Example response (truncated for brevity) looks like:
```json
{
  "data": {
    "letter":"B",
    "rotation":["4","5","6"],
    "schedule":[
      {
        "name":"Extended Block",
        "start":"2018-09-12T12:00:00.000Z",
        "end":"2018-09-12T12:45:00.000Z",
        "period":"4",
        "isExtended": 1
      },
      {
        "name":"Class",
        "start":"2018-09-12T12:45:00.000Z",
        "end":"2018-09-12T14:00:00.000Z",
        "period":"4"
      },
      {
        "name":"Lunch",
        "start":"2018-09-12T16:00:00.000Z",
        "end":"2018-09-12T16:45:00.000Z"
      },
      {
        "name":"X Block",
        "start":"2018-09-12T17:35:00.000Z",
        "end":"2018-09-12T18:20:00.000Z"
      },
      {
        "name":"Class",
        "start":"2018-09-12T18:20:00.000Z",
        "end":"2018-09-12T19:35:00.000Z",
        "period":"6"
      }
    ]
  }
}
```
Note that any classes or extended blocks are labeled by period, and all start and end dates are [ISO 8601 strings](https://en.wikipedia.org/wiki/ISO_8601). Extended blocks are marked with an `isExtended` value of 1.

---
##### GET `/infoToday`
Get all schedule info for today's date, if any exists. Same response format as `/infoByDate`.

---
##### POST `/letterByWeek`
Get an array of letter day and rotation info for an entire (future) week by posting some date within that week under the name `date`. Example response would look like:
```json
{
  "data":
    [
      { "date":"2018-09-10T04:00:00.000Z", "letter":"F", "rotation":["4","5","6"] },
      { "date":"2018-09-11T04:00:00.000Z", "letter":"A", "rotation":["1","2","3"] },
      { "date":"2018-09-12T04:00:00.000Z", "letter":"B", "rotation":["6","5","4"] },
      { "date":"2018-09-13T04:00:00.000Z", "letter":"C", "rotation":["2","3","1"] },
      { "date":"2018-09-14T04:00:00.000Z", "letter":"D", "rotation":["5","6","4"] }
    ]
}
```
The `"date"` string is the full date of that day of the week.

---
##### POST `/infoByWeek`
Get array of *all* schedule info for an entire (future) week by posting some date within that week under the name `date`. Response format is the same as `/letterByWeek`, but with an added `schedule` array of objects in the same format as the `schedule` array from `/infoByDate` and `/infoToday`.

---
##### POST `/eventsByTime`
Get an array of events that are occurring at a given *future* time, if any, by posting a datetime under the name `date`. For example, at the time of writing, posting `"2018-09-14 14:34:00"` would yield a response of:
```json
{
  "data":
    [
      {
        "name":"Extended Block",
        "start":"2018-09-14T18:00:00.000Z",
        "end":"2018-09-14T18:45:00.000Z",
        "period":"4",
        "isExtended": 1
      },
      {
        "name":"X Block",
        "start":"2018-09-14T18:00:00.000Z",
        "end":"2018-09-14T18:45:00.000Z"
      }
    ]
}
```
which tells us that, during this time, both X Block and Extended 4th Period class time will be occurring.

---
##### GET `/eventsRightNow`
Get an array of any events occurring at the current time. Same response format as `/eventsByTime`. 

## Installation

First, run `npm install` to install project dependencies. This software requires a `credentials.js` file with the following format: 
```javascript
module.exports = {
	schoolEventsCalendar: '<YOUR CALENDAR FEED URL HERE>'
}
```

The server may be started with `node server.js` which should output something like:
```
Letter Day server listening on port 8080
```
