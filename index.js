const Bacon = require('baconjs')
const {
  toSentence,
  computeChecksum,
  toHexString,
  radsToDeg,
  padd,
  toNmeaDegrees
} = require('./nmea')
const path = require('path')
const fs = require('fs')

module.exports = function (app) {
  var plugin = {
    unsubscribes: []
  }

  plugin.id = 'nmea0183-vdr'
  plugin.name = 'NMEA0183 logging'
  plugin.description = 'Plugin to log voyage data into a NMEA0183 formatted file'

  plugin.schema = {
    type: 'object',
    title: 'Conversions to NMEA0183 and logging into file',
    description:
      'If there is SK data for the conversion, generate and log the following NMEA0183 sentences from Signal K data:',
    properties: {}
  }

  plugin.start = function (options) {
    //app.debug('Options: ' + JSON.stringify(options));
    plugin.logfile = fs.createWriteStream(options.logfilename, {flags:'a'});
    const selfContext = 'vessels.' + app.selfId
    const selfMatcher = delta => delta.context && delta.context === selfContext

    function mapToNmea (encoder, throttle) {
      const selfStreams = encoder.keys.map((key, index) => {
        let stream = app.streambundle.getSelfStream(key)
        if (encoder.defaults && typeof encoder.defaults[index] != 'undefined') {
          stream = stream.merge(Bacon.once(encoder.defaults[index]))
        }
        return stream
      }, app.streambundle)
      const sentenceEvent = encoder.sentence ? `g${encoder.sentence}` : undefined

      let stream = Bacon.combineWith(function () {
        try {
          return encoder.f.apply(this, arguments)
        } catch (e) {
          console.error(e.message)
        }
      }, selfStreams)
        .filter(v => typeof v !== 'undefined')
        .changes()
        .debounceImmediate(20)

      if (throttle) {
        stream = stream.throttle(throttle)
      }

      plugin.unsubscribes.push(
        stream
          .onValue(nmeaString => {
	    plugin.logfile.write(nmeaString + "\n")
          })
      )
    }

    Object.keys(plugin.sentences).forEach(name => {
      if (options[name]) {
        mapToNmea(plugin.sentences[name], options[getThrottlePropname(name)])
      }
    })
  }

  plugin.stop = function () {
    plugin.unsubscribes.forEach(f => f())
  }

  plugin.sentences = loadSentences(app, plugin)
  buildSchemaFromSentences(plugin)
  return plugin
}

function buildSchemaFromSentences (plugin) {
  plugin.schema.properties["logfilename"] = {
    title: `Log file name`,
    type: 'string',
    default: '/tmp/nmea.log'
  }
  Object.keys(plugin.sentences).forEach(key => {
    var sentence = plugin.sentences[key]
    const throttlePropname = getThrottlePropname(key)
    plugin.schema.properties[key] = {
      title: sentence['title'],
      type: 'boolean',
      default: false
    }
    plugin.schema.properties[throttlePropname] = {
      title: `${key} throttle ms`,
      type: 'number',
      default: 0
    }
  })
}

function loadSentences (app, plugin) {
  const fpath = path.join(__dirname, 'sentences')
  return fs
    .readdirSync(fpath)
    .filter(filename => filename.endsWith('.js'))
    .reduce((acc, fname) => {
      let sentence = path.basename(fname, '.js')
      acc[sentence] = require(path.join(fpath, sentence))(app, plugin)
      return acc
    }, {})
}

const getThrottlePropname = (key) => `${key}_throttle`
