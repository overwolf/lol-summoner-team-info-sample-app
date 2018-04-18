define([
  '/utils/SimpleIOPlugin.js'
], function(_simpleIoPlugin) {
  const SUMMONER_INFO_FETCHER_INTERVAL_MS = 2000;
  const SUMMONER_INFO_FETCHER_MAX_RETRIES = 20;
  const LOL_CEF_CLIENT_LOG_LISTENER_ID = 'LOL_CEF_CLIENT_LOG_LISTENER_ID';
  const SUMMONER_NAME_REGEX = /.*\"localPlayerCellId\":(\d),\"myTeam\":(\[.*\]).*/;

  let _gameInfo = null;
  let _timerId = null;
  let _cefRegionTimer = null;
  let _cefSummonerNameTimer = null;
  let _retries = 0;
  let _cefRegionRetries = 0;
  let _cefSummonerNameRetries = 0;
  let _fileListenerRetries = 0;
  let _gameRoot;
  let _ioPlugin;

  function start(gameInfo) {
    if (gameInfo == null) {
      console.error("SummonerInfoFetcher - passed null gameInfo");
      return false;
    }

    console.log('starting summoner info fetcher.');

    _simpleIoPlugin.get(function(ioPlugin){
      _ioPlugin = ioPlugin;

      stop();

      _gameInfo = gameInfo;
      _gameRoot = _getGameRoot(gameInfo);

      _retries = 0;
      _cefRegionRetries = 0;
      _cefSummonerNameRetries = 0;
      _fileListenerRetries = 0;

      _timerId = setTimeout(_extractSummonerInfoCefClient, 0);
    });

    return true;
  }

  function stop() {
    clearTimeout(_timerId);
    clearTimeout(_cefRegionTimer);
    clearTimeout(_cefSummonerNameTimer);

    _ioPlugin.stopFileListen(LOL_CEF_CLIENT_LOG_LISTENER_ID);
    _ioPlugin.onFileListenerChanged.removeListener(_cefClientLogFileListener);
  }

  function _getGameRoot(gameInfo) {
    let gameRoot;
    let gamePath = gameInfo.path;
    let pathIndex = gamePath.indexOf("RADS");

    if (pathIndex < 0) {
      pathIndex = gamePath.lastIndexOf("/") + 1;
    }

    gameRoot = gamePath.substring(0, pathIndex);
    return gameRoot;
  }

  function _extractSummonerInfoCefClient() {
    _getRegionCefClient(regionCallback);
    _getSummonerNameCefClient(summonerNameCallback);
  }

  function _getRegionCefClient(callback) {
    _cefRegionRetries++;
    if (_cefRegionRetries === SUMMONER_INFO_FETCHER_MAX_RETRIES) {
      console.error('SummonerInfoFetcher - CEF region reached max retries!');
      sendTrack('REGION_FETCH_FAILURE');
      stop(_cefRegionTimer);
      return;
    }

    let filename = _gameRoot + "Config/LeagueClientSettings.yaml";
    let regEx = /region:\s*"(.*)"/gmi;
    console.log("extract region from new client: ", filename);
    _extractRegionFromFile(filename, regEx, callback);
  }

  // callback = function(status, statusReason, region)
  function _extractRegionFromFile(filename, regEx, callback) {
    if (!_ioPlugin) {
      return callback(false, "no IO plugin", null);
    }

    _ioPlugin.getTextFile(filename, false, function (status, data) {
      if (!status) {
        return setTimeout(function () {
          callback(false, "failed to read " + filename, null);
        }, 1);
      }

      let match = regEx.exec(data);

      if ((null == match) || (match.length !== 2)) {
        return setTimeout(function () {
          callback(false, "failed to read region from " + filename, null);
        }, 1);
      }

      return setTimeout(function () {
        callback(true, null, match[1].toUpperCase());
      }, 1);
    });
  }

  function regionCallback(status, statusReason, region) {
    // if we fail - retry
    if (!status) {
      console.error(statusReason);

      _cefRegionTimer = setTimeout(function () {
        _getRegionCefClient(regionCallback);
      }, SUMMONER_INFO_FETCHER_INTERVAL_MS);

      return;
    }

    let div = document.getElementById('region');
    div.innerHTML = region;
    console.info(`My region: ${region}`);
  }

  function summonerNameCallback(status, statusReason) {
    // if we fail - retry
    if (!status) {
      console.error(statusReason);

      _cefSummonerNameTimer = setTimeout(function() {
        _getSummonerNameCefClient(summonerNameCallback);
      }, SUMMONER_INFO_FETCHER_INTERVAL_MS);

    }
  }

  function _getSummonerNameCefClient(callback) {
    let path = _gameRoot + 'Logs/LeagueClient Logs/';
    let filePattern = path + '*_LeagueClient.log';

    _cefSummonerNameRetries++;
    if (_cefSummonerNameRetries === SUMMONER_INFO_FETCHER_MAX_RETRIES) {
      console.error('SummonerInfoFetcher - CEF region reached max retries!');
      sendTrack('SUMMONER_NAME_FETCH_FAILURE');
      stop(_cefSummonerNameTimer);
      return;
    }


    _ioPlugin.getLatestFileInDirectory(filePattern, function(status, logFileName) {
      let fullLogPath;

      if (!status || !logFileName.endsWith(".log")) {
        return callback(false, "couldn't find log file", null);
      }

      fullLogPath = path + logFileName;

      _ioPlugin.onFileListenerChanged.addListener(_cefClientLogFileListener);

      console.log('starting to listen on ' + fullLogPath);
      _listenOnCefClientLog(fullLogPath, callback);

    });
  }

  function _listenOnCefClientLog(fullLogPath, callback) {
    let skipToEnd = false;

    console.log('starting to listen on ' + fullLogPath);
    _fileListenerRetries++;

    if (_fileListenerRetries >= SUMMONER_INFO_FETCHER_MAX_RETRIES) {
      _ioPlugin.stopFileListen(LOL_CEF_CLIENT_LOG_LISTENER_ID);
      _ioPlugin.onFileListenerChanged.removeListener(_cefClientLogFileListener);
      callback(false, 'failed to stream cef log file', null);
      return;
    }

    _ioPlugin.listenOnFile(LOL_CEF_CLIENT_LOG_LISTENER_ID,
      fullLogPath, skipToEnd, function (id, status, data) {
        if (!status) {
          console.log("failed to stream " + id + ' (' + data + '), retrying...');
          return setTimeout(_listenOnCefClientLog, 500);
        }

        console.log('now streaming ' + id);
        callback(true);
      });
  }

  function _cefClientLogFileListener(id, status, line) {
    if (id !== LOL_CEF_CLIENT_LOG_LISTENER_ID) {
      return;
    }

    if (!status) {
      console.error("received an error on file: " + id + ": " + line);
      return;
    }

    if (line.includes('lol-champ-select|')) {
      // looking for specific actions instead of the whole actions JSON
      // since sometimes the actions JSON is invalid

      let matches = line.match(SUMMONER_NAME_REGEX);
      if (matches && (matches.length >= 3)) {
        try {
          let localPlayerCellId = Number(matches[1]);
          let myTeam = matches[2];
          myTeam = myTeam.substring(0, myTeam.indexOf("]") + 1);
          _printMyTeam(localPlayerCellId, myTeam);
        } catch (e) {
          console.error('failed to parse log line: ' + e.message);
        }
      }
    }
  }

  function _printMyTeam(localPlayerCellId, myTeam) {
    let div = document.getElementById('my-team');
    let text = '';
    myTeam = JSON.parse(myTeam);
    for (let playerInfo of myTeam) {
      text += '<br>' + playerInfo.displayName;
      if (playerInfo.cellId === localPlayerCellId) {
        let summonerName = playerInfo.displayName;
        summonerName = summonerName.toLowerCase();
        _ioPlugin.stopFileListen(LOL_CEF_CLIENT_LOG_LISTENER_ID);
        _ioPlugin.onFileListenerChanged.removeListener(_cefClientLogFileListener);

        console.log('ME: ' + summonerName);
        // break;
      }
    }
    div.innerHTML = text;
    console.table(myTeam);
  }

  /**
   * Send tracking/monitoring info
   * @param info
   */
  function sendTrack(info) {
    let URL_TRACKING = "http://bugs.somewhere.com/endpoint";
    let payload = {
      info: info
    };

    let xmlhttp = new XMLHttpRequest();
    xmlhttp.open("POST", URL_TRACKING);
    xmlhttp.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xmlhttp.send(JSON.stringify(payload));
  }
  return {
    start: start,
    stop: stop
  }
});