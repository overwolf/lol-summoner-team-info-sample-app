define(function() {
    var _simpleIOPlugin = null;
    var MAX_RETRIES = 5;
    var retries = 0;

    // loadIOPlugin();

    function get(callback) {
        if (_simpleIOPlugin) {
            return callback(_simpleIOPlugin);
        }

        return loadIOPlugin(callback);
    }

    function loadIOPlugin(callback) {
        callback = callback || function () {};

        if (_simpleIOPlugin) {
            return callback(_simpleIOPlugin);
        }

        overwolf.extensions.current.getExtraObject("simple-io-plugin", function(result) {
            if (result.status == "success") {
                _simpleIOPlugin = result.object;
                callback(_simpleIOPlugin);
                return;
            }

            if (retries >= MAX_RETRIES) {
                console.log("reached max retries for ioplugin");
                return callback(null);
            }

            console.log("Fail to load ioplugin, retrying", result);
            retries++;
            setTimeout(function () {
                loadIOPlugin(callback);
            }, 500);
        });
    }

    return {
        get: get
    }
});
