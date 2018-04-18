"use strict";

define([
  '/utils/SummonerInfoFetcher.js',
],function(
  summonerInfoFetcher
) {

  function _getLauncherInfo() {
    overwolf.games.launchers.getRunningLaunchersInfo((info) => {
      if (info.launchers.length) {
        summonerInfoFetcher.start(info.launchers[0]);
      } else {
        setTimeout(_getLauncherInfo, 1000);
      }
    });
  }

  _getLauncherInfo();

});