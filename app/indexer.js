'use strict';

var path = require('path'),
    process = require('process'),
    chokidar = require('chokidar'),
    AutoLaunch = require('auto-launch'),
    fs = require('fs'),
    os = require('os'),
    electron = require('electron'),
    Config = require('electron-config'),
    lokijs = require('lokijs'),
    glob = require('multi-glob').glob,

    btnReindex = document.querySelector('.btnReindex'),
    btnSelectRoot = document.querySelector('.btnSelectRoot'),
    pathSelectedContent = document.querySelector('.pathSelectedContent'),
    scanFolderDisplay = document.querySelector('.scanFolder'),
    currentAction = document.querySelector('.currentAction'),
    cbAutostart = document.querySelector('.cbAutostart'),
    scanFolderWrapper = document.querySelector('.scanFolderWrapper'),
    filesFoundCount = document.querySelector('.filesFoundCount'),
    outputLog = document.querySelector('.outputLog'),
    openLogLink = document.querySelector('.openLog'),
    dataFolder = path.join(electron.remote.app.getPath('appData'), 'myStreamCCIndexer'),
    lokijsPath =  path.join(dataFolder, 'persist.json'),
    lokijsdb = new lokijs(lokijsPath),
    _fileDataCollection,
    _mainWindow,
    Tray = electron.remote.Tray,
    Menu = electron.remote.Menu,
    dialog = electron.remote.dialog,
    _busyReadingFiles = false,
    watchedExtensions = ['.mp3', '.m4a'],
    _filesChanged = false,
    _allFiles = {},
    outputLogFile = path.join(dataFolder, 'output.log'),
    watcher,
    config = new Config(),
    autoLaunch = new AutoLaunch({ name: 'Indexer' }),
    _scanFolder = config.get('scanFolder'),
    _dropboxFolder = config.get('dropboxRoot'),
    _isAutostarting = config.get('autoStart'),
    _errorsOccurred = false,
    _tray = null;    

if (!fs.existsSync(dataFolder))
    fs.mkdirSync(dataFolder);

// starts everything
var mode ='';
if (mode === 'debug'){
    setTimeout(() => {
       initLoki(); 
    }, 1000);
} else 
    initLoki();

function initLoki(){
    // load lokidb, this is async
    if (fs.existsSync(lokijsPath)){
        lokijsdb.loadDatabase({}, function(){
            _fileDataCollection = lokijsdb.getCollection('fileData');
            onLokiReady();
        });
    } else {
        _fileDataCollection = lokijsdb.addCollection('fileData',{ unique:['file']});
        onLokiReady();
    }
}

// continues after loki db has initialized
function onLokiReady(){

    // if loki hasn't loaded, its json file is corrupt, 
    if (!_fileDataCollection){
        fs.unlink(lokijsPath);
        console.log('loki file corrupt, resetting');
        return initLoki();
    }

    // set state of "auto start" checkbox
    if (_isAutostarting === undefined || _isAutostarting === null)
        _isAutostarting = false;
    cbAutostart.checked = _isAutostarting;

    // set autostart service for next time app starts
    if (cbAutostart)
        autoLaunch.enable();
    else
        autoLaunch.disable();

    setStateBasedOnScanFolder();

    btnSelectRoot.addEventListener('click', function(){

        var folder = dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (folder && folder.length){
            _scanFolder = folder[0];
            config.set('scanFolder', _scanFolder);

            _dropboxFolder = resolveDropboxPathFragment(_scanFolder);
            if (_dropboxFolder === null){
                setCurrentAction('Your music folder does not seem to be in your Dropbox folder');
            }

            _allFiles = {}; // force reset content
        }

        setStateBasedOnScanFolder();

    }, false);

    cbAutostart.addEventListener('change', function() {
        config.set('autoStart', cbAutostart.checked);

        if (cbAutostart.checked)
            autoLaunch.enable();
        else
            autoLaunch.disable();
    });

    openLogLink.addEventListener('click', function(){
        electron.shell.openItem(outputLogFile);
    });

    btnReindex.addEventListener('click', function() {
        _fileDataCollection.clear(); // force flush collection
        lokijsdb.saveDatabase();
        
        scanAllFiles(function(){
            _filesChanged = true;
        });

    }, false);

    bindMainWindowEvents();

    electron.remote.app.on('ready', function() {
        onAppReady();
    });

    if (electron.remote.app.isReady()){
        onAppReady();
    }
}


/** 
 * Bind all mainWindow stuff here, mainWindow is finicky to retrieve on dev environments, I'm
 * assuming because it doesn't have focus over the console window, so getFocusWindow returns 
 * null. 
 */
function bindMainWindowEvents(){
    function bind(){

        _mainWindow.on('minimize',function(e){
            e.preventDefault();
            _mainWindow.hide();
        });
    
        _mainWindow.on('close', function (e) {
            if( !electron.remote.app.isQuiting){
                e.preventDefault();
                _mainWindow.hide();
            }
            return false;
        });
    }

    var attempts = 0,
    mainWindowFindTimer = setInterval(function(){
        attempts ++;

        var mainWindow,
            allwindows = electron.remote.BrowserWindow.getAllWindows();

        if (allwindows && allwindows.length === 1)
            mainWindow = allwindows[0];
    
        if (!mainWindow)
            mainWindow = electron.remote.BrowserWindow.getFocusedWindow(); 

        if (mainWindow || attempts > 20){
            clearInterval(mainWindowFindTimer);
            _mainWindow = mainWindow;
            if (mainWindow)
                bind();
        }
    }, 500);

}


/**
 * Writes current action to UI. Only one action is displayed at a time. Use this to inform user what app is currently
 * doing.
 */
function setCurrentAction(action){
    currentAction.innerHTML = action;
}


/**
 * Resolves path fragment from scanFolder to get to dropbox root. Returns null
 * if no path found.
 */
function resolveDropboxPathFragment(startFolder){

    var current = startFolder;

    do {
        // is current dropbox root?
        if (fs.existsSync(path.join(current, '.dropbox')) || fs.existsSync(path.join(current, '.dropbox.cache'))){
            return current.replace(/\\/g, '/');
        }

        var parent = path.join(current, '../');
        if (current === parent)
            break;

        current = parent;    
    }
    while(fs.existsSync(current));

    return null;
};
    

/** 
 *  1) scan all fires - store in array
 *  2) add all changes to array
 *  3) on change, pause 2 seconds, then write xml file
 *  4) if change while writing, queue change until done
 */
function registerFileChange(file, action){
    var extension = path.extname(file);
    
    if (watchedExtensions.indexOf(extension) === -1)
        return;

    if (action === 'delete')
        delete _allFiles[file];
    else{
        _allFiles[file] = _allFiles[file] || {};
        _allFiles[file].file = file;
    }

    _filesChanged = true;
}


/**
 * Writes item to output log. Log should be for errors only, not general status. Log is cleared each time app
 * starts.
 */
function writeToLog(text){
    fs.appendFile(outputLogFile, text + os.EOL, function(err){
        if (err)
            console.log(err);
    });
}


/**
 * Called when music files in the watched folder change. Reads mp3 tags for all files found, 
 * then writes XML from those tags. All files are read for any change because all data has to 
 * written to a single index file. 
 * 
 * This can be optimized by 
 */
function handleFileChanges(){

    if (!_filesChanged)
        return;

    if (_busyReadingFiles)
        return;

    _filesChanged = false;
    _busyReadingFiles = true;
    _errorsOccurred = false;
    btnReindex.style.display = 'none';
    outputLog.innerHTML = '';
    openLogLink.style.display = 'none';

    if (_dropboxFolder === null){
        setCurrentAction('The path you selected is not within a Dropbox folder.');
        return;
    }

    // clear output log
    fs.writeFileSync(outputLogFile, '');

    var processedCount = 0,
        allProperties = Object.keys(_allFiles),
        filesToProcessCount = allProperties.length;

    filesFoundCount.innerHTML = (filesToProcessCount ? filesToProcessCount : 'No') + ' files found.';

    var intervalBusy = false,
        jsmediatags = require('jsmediatags');

    var timer = setInterval(function(){

        if (intervalBusy)
            return;

        intervalBusy = true;

        _busyReadingFiles = true;

        // check if all objects have been processed, if so write xml from loki and exit
        if (processedCount === filesToProcessCount - 1){
            _busyReadingFiles = false;
            lokijsdb.saveDatabase();
            clearInterval(timer);
            generateXml();
            intervalBusy = false;
            return;
        }

        var file = allProperties[processedCount];
        setCurrentAction('Checking ' + file);

        // ensure file exists, during deletes this list can be slow to update
        if (!fs.existsSync(file)) {
            delete _allFiles[file];
            processedCount ++;
            intervalBusy = false;
            return;
        }

        // check if file data is cached in loki, and if file was updated since then
        var fileStats,
            fileCachedData = _fileDataCollection.by('file', file);

        if (fileCachedData){
            fileStats = fs.statSync(file);
            if (fileStats.mtime.toString() === fileCachedData.mtime){
                processedCount ++;
                intervalBusy = false;
                return;
            }
        }

        var insert = false;
        if (!fileCachedData){
            fileCachedData = {
                file : file
            };
            insert = true;
        }

        // reads tags from file, this is slow hence loki caching
        jsmediatags.read(file, {
            onSuccess: function(tag) {

                processedCount ++;
                setCurrentAction('Reading file ' + processedCount + ' of ' + filesToProcessCount + ' : ' + file);

                if (tag.type === 'ID3' || tag.type === 'MP4'){
                    var fileNormalized = file.replace(/\\/g, '/');

                    fileCachedData.dirty = true;
                    fileCachedData.mtime = fileStats ? fileStats.mtime.toString() : '';
                    fileCachedData.tagData  = {
                        name : tag.tags.title,
                        album : tag.tags.album,
                        track : tag.tags.track,
                        artist : tag.tags.artist,
                        clippedPath : fileNormalized.replace(_dropboxFolder, '/').replace(/\\/g, '/')
                    };

                    if (insert)
                        _fileDataCollection.insert(fileCachedData);
                    else
                        _fileDataCollection.update(fileCachedData);
                }

                intervalBusy = false;
            },
            onError: function(error) {
                processedCount ++;
                var message = '';

                if (error.type && error.type === 'tagfail'){
                    message = file + ' tag read fail.';
                } else {
                    message = file + ' could not be read, is it properly tagged?';
                }

                fileCachedData.dirty = false;
                fileCachedData.mtime = fileStats ? fileStats.mtime.toString() : '';
                fileCachedData.tagData  = null;

                if (insert)
                    _fileDataCollection.insert(fileCachedData);
                else
                    _fileDataCollection.update(fileCachedData);

                writeToLog(message + ' : ' + JSON.stringify(error));
                _errorsOccurred = true;
                intervalBusy = false;
            }
        }); // timer function
    }, 2); // timer

}


/**
 * Writes XML index file from data in _allFiles.
 */ 
function generateXml(){
    var writer = null;
    
    // abort if busy, will be called again
    if (_filesChanged || _busyReadingFiles)
        return;

    // check for dirty files
    var dirty = _fileDataCollection.find({dirty :  true});
    if (!dirty.length)
    {
        setCurrentAction('Watching for changes ...');
        btnReindex.style.display = 'inline';
        return;
    }

    setCurrentAction('Indexing ... ');

    // force rebuild array, this tends to lag behind
    var allProperties = Object.keys(_allFiles),
        lineoutcount = 0,
        id3Array = [],
        XMLWriter = require('xml-writer'),
        writer = new XMLWriter();

    writer.startDocument();
    writer.startElement('items');

    for (var i = 0 ; i < allProperties.length ; i ++) {

        lineoutcount ++;

        // abort if busy, will be called again
        if (_filesChanged || _busyReadingFiles)
            return;

        var fileData = _fileDataCollection.by('file', allProperties[i]);
        if (!fileData)
            continue; // this should never happen

        if (!fileData.tagData)
            continue;

        var id3 = fileData.tagData;

        if (!id3 || !id3.album || !id3.artist || !id3.name)
            continue;

        writer.startElement('item');
        writer.writeAttribute('album', id3.album);
        writer.writeAttribute('artist', id3.artist);
        writer.writeAttribute('name', id3.name);
        writer.writeAttribute('path', id3.clippedPath);
        writer.endElement();

        setCurrentAction('Indexing ' + lineoutcount + ' of ' + id3Array.length + ', ' + id3.artist + ' ' + id3.name);
    }

    writer.endElement();
    writer.endDocument();

    var xml = writer.toString();
    fs.writeFileSync(path.join(_dropboxFolder, '.myStream.dat'), xml);

    // clean dirty records
    for (var i = 0 ; i < dirty.length ; i ++){
        var record = dirty[i];
        record.dirty = false;
        _fileDataCollection.update(record);
    }

    // remove orphans
    var orphans = _fileDataCollection.where(function(r){
        return allProperties.indexOf(r.file) === -1;
    });

    for (var i = 0 ; i < orphans.length ; i ++) {
        _fileDataCollection.remove(orphans[i]);
    }

    lokijsdb.saveDatabase();

    setCurrentAction('New index file written. Watching for changes ...');
    btnReindex.style.display = 'inline';

    if (_errorsOccurred)
        openLogLink.style.display = 'block';
}

/**
 * Called when the "reindex now" button is clicked. Force rescans and reindexex everything. Does not directly trigger reindex, 
 * just queues all files as changed.
 */
function scanAllFiles (callback){
    if (_busyReadingFiles)
        return;
    _busyReadingFiles = true;

    var root = _scanFolder.replace(/\\/g, '/');

    setCurrentAction('Scanning files, this can take a while ... ');
    
    var globPaths = [];
    for (var i = 0; i < watchedExtensions.length ; i ++)
        globPaths.push(path.join(root, '**/*' + watchedExtensions[i]));

    glob(globPaths, { }, function(er, files) {
        if (er)
            throw er;

        setCurrentAction('Found ' + files.length + ' files');

        _allFiles = {};
        for (var i = 0 ; i < files.length ; i ++)
            _allFiles[files[i]] = {
                file : files[i] // todo : check if this is still used
            };

        _busyReadingFiles = false;
        if (callback)
            callback();
    });
}


/**
 * Does final setup stuff when app is ready
 */
function onAppReady(){
    _tray = new Tray(__dirname + '/resources/windows/icon.ico');

    var contextMenu = Menu.buildFromTemplate([
        {label: 'Show', click:  function() {
            _mainWindow.show();
        } },
        {label: 'Quit', click:  function(){
            electron.remote.app.isQuiting = true;
            electron.remote.app.quit();

        } }
    ]);

    _tray.setToolTip('myStream.cc Indexer');
    _tray.setContextMenu(contextMenu);
}


/**
 * Initialize watcher for file changes. This happens on app start, and when a new watch
 * folder is selected.
 */
function setStateBasedOnScanFolder(){
    
    if (!_scanFolder)
        return;

    _dropboxFolder = resolveDropboxPathFragment(_scanFolder);

    pathSelectedContent.style.display = 'block';
    scanFolderWrapper.style.display = 'block';
    scanFolderDisplay.innerHTML = _scanFolder;

    if (_dropboxFolder === null){
        setCurrentAction('Error : Your music folder is not in your Dropbox folder');
    } else {

        scanAllFiles(function(){

            watcher = chokidar.watch([_scanFolder], {
                persistent: true,
                ignoreInitial : true,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                }
            });
            
            // start watched for file changes
            watcher
                .on('add', function(p) {
                    registerFileChange(p, 'add');
                })
                .on('change', function(p){
                    registerFileChange(p, 'change');
                })
                .on('unlink', function(p){
                    registerFileChange(p, 'delete');
                });
                
            // start handler for observed file changes    
            setInterval(function(){
                handleFileChanges();
            }, 1000);
        });

        
    }
   
}
