'use strict';

var _path = require('path'),
    _chokidar = require('chokidar'),
    _AutoLaunch = require('auto-launch'),
    _fs = require('fs'),
    _os = require('os'),
    _jsmediatags = require('jsmediatags'),
    _jsonfile = require('jsonfile'),
    _electron = require('electron'),
    _Config = require('electron-config'),
    _lokijs = require('lokijs'),
    _glob = require('multi-glob').glob,
    _btnReindex = document.querySelector('.btnReindex'),
    _btnSelectRoot = document.querySelector('.btnSelectRoot'),
    _pathSelectedContent = document.querySelector('.pathSelectedContent'),
    _scanFolderDisplay = document.querySelector('.scanFolder'),
    _currentAction = document.querySelector('.currentAction'),
    _removeScanFolder = document.querySelector('.removeScanFolder'),
    _cbAutostart = document.querySelector('.cbAutostart'),
    _allFilesTable = document.querySelector('.allFilesTable'),
    _cbStartMinimized = document.querySelector('.cbStartMinimized'),
    _scanFolderWrapper = document.querySelector('.scanFolderWrapper'),
    _filesFoundCount = document.querySelector('.filesFoundCount'),
    _noScanFolderContent = document.querySelector('.layout-musicDisabled'),
    _scanFolderSelectedContent = document.querySelector('.layout-musicEnabled'),
    _focusSettings = document.querySelector('.focusSettings'),
    _status = document.querySelector('.status'),
    _filesTableFilterErrors = document.querySelector('[id="filesTableFilterErrors"]'),
    _filesTableFilterAll = document.querySelector('[id="filesTableFilterAll"]'),
    _openLogLink = document.querySelector('.openLog'),
    _dataFolder = _path.join(_electron.remote.app.getPath('appData'), 'myStreamCCIndexer'),
    _lokijsPath =  _path.join(_dataFolder, 'persist.json'),
    _lokijsdb = new _lokijs(_lokijsPath),
    _fileDataCollection,
    _mainWindow,
    _Tray = _electron.remote.Tray,
    _menu = _electron.remote.Menu,
    _dialog = _electron.remote.dialog,
    _busyReadingFiles = false,
    _watchedExtensions = ['.mp3', '.m4a'],
    _filesChanged = false,
    _allFiles = {},
    _outputLogFile = _path.join(_dataFolder, 'output.log'),
    _watcher,
    _config = new _Config(),
    _autoLaunch = new _AutoLaunch({ name: 'Indexer' }),
    _storageRootFolder = _config.get('storageRoot'),
    _isAutostarting = _config.get('autoStart'),
    _isStartMinimized = _config.get('startMinimized'),
    _errorsOccurred = false,
    _mode = '',
    _tray = null;    

if (!_fs.existsSync(_dataFolder))
    _fs.mkdirSync(_dataFolder);

// starts everything
if (_mode === 'debug'){
    setTimeout(() => {
       initLoki(); 
    }, 1000);
} else 
    initLoki();

function initLoki(){
    // load lokidb, this is async
    if (_fs.existsSync(_lokijsPath)){
        _lokijsdb.loadDatabase({}, function(){
            _fileDataCollection = _lokijsdb.getCollection('fileData');
            onLokiReady();
        });
    } else {
        _fileDataCollection = _lokijsdb.addCollection('fileData',{ unique:['file']});
        onLokiReady();
    }
}

// continues after loki db has initialized
function onLokiReady(){

    // if loki hasn't loaded, its json file is corrupt, 
    if (!_fileDataCollection){
        _fs.unlink(_lokijsPath);
        console.log('loki file corrupt, resetting');
        return initLoki();
    }

    // set state of "auto start" checkbox
    if (_isAutostarting === undefined || _isAutostarting === null)
        _isAutostarting = false;
    _cbAutostart.checked = _isAutostarting;

    if (_isStartMinimized === undefined || _isStartMinimized === null)
        _isStartMinimized = false;
    _cbStartMinimized.checked = _isStartMinimized;

    // set autostart service for next time app starts
    if (_cbAutostart)
        _autoLaunch.enable();
    else
        _autoLaunch.disable();

    setStateBasedOnScanFolder();

    // bind UI event handlers

    // unbinds scan folder
    _removeScanFolder.addEventListener('click', function(){
        const approved = _dialog.showMessageBox({
            type: 'question',
            buttons: ['No', 'Yes'],
            title: 'Confirm',
            message: 'Are you sure you want to unbind this folder? (You can always rebind it again)'
        });

        if(!approved)
            return;

        // need to delete existing index
        const indexPath = getIndexPath();
        if (_fs.existsSync(indexPath))
            _fs.unlinkSync(indexPath);

        const statusPath = getStatusPath();
        if (_fs.existsSync(statusPath))
            _fs.unlinkSync(statusPath);

        setStorageRootFolder(null);
        setStateBasedOnScanFolder();
    }, false);

    //
    _focusSettings.addEventListener('click', function() {
        window.__glu_verticalTabs['mainTabs'].focusNamed('settings')
    });

    // binds scan folder
    _btnSelectRoot.addEventListener('click', function(){
        const folder = _dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (folder && folder.length)
            setStorageRootFolder(folder[0]);

        _filesChanged = true;
        setStateBasedOnScanFolder();
    }, false);

    _filesTableFilterErrors.addEventListener('change', function() {
        fillFileTable();
    });
    
    _filesTableFilterAll.addEventListener('change', function() {
        fillFileTable();
    });

    _cbAutostart.addEventListener('change', function() {
        _config.set('autoStart', _cbAutostart.checked);

        if (_cbAutostart.checked)
            _autoLaunch.enable();
        else
            _autoLaunch.disable();
    });

    _cbStartMinimized.addEventListener('change', function() {
        _config.set('startMinimized', _cbStartMinimized.checked);
    });

    _openLogLink.addEventListener('click', function(){
        _electron.shell.openItem(_outputLogFile);
    });

    _btnReindex.addEventListener('click', function() {
        _fileDataCollection.clear(); // force flush collection
        _lokijsdb.saveDatabase();
        
        scanAllFiles(function(){
            _filesChanged = true;
        });

    }, false);

    bindMainWindowEvents();

    _electron.remote.app.on('ready', function() {
        onAppReady();
    });

    if (_electron.remote.app.isReady()){
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
            if( !_electron.remote.app.isQuiting){
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
            allwindows = _electron.remote.BrowserWindow.getAllWindows();

        if (allwindows && allwindows.length === 1)
            mainWindow = allwindows[0];
    
        if (!mainWindow)
            mainWindow = _electron.remote.BrowserWindow.getFocusedWindow(); 

        if (mainWindow || attempts > 20){
            clearInterval(mainWindowFindTimer);
            _mainWindow = mainWindow;
            if (mainWindow){

                bind();
                // hide menu
                mainWindow.setMenu(null)

                // autohide indexer on start, this isn't the best way of doing it
                // as you can still see app starting
                if (_isStartMinimized)
                    mainWindow.hide();
            }

        }
        
    }, 500);

}


function toUnixPaths(path){
    return path.replace(/\\/g, '/');
}

/**
 * Writes current action to UI. Only one action is displayed at a time. Use this to inform user what app is currently
 * doing.
 */
function setProgress(action){
    _currentAction.innerHTML = action;
}


/**
 * 
 */
function setStatus(status){
    _status.innerHTML = status;
}


/** 
 *  1) scan all fires - store in array
 *  2) add all changes to array
 *  3) on change, pause 2 seconds, then write xml file
 *  4) if change while writing, queue change until done
 */
function registerFileChange(file, action){
    var extension = _path.extname(file);
    
    if (_watchedExtensions.indexOf(extension) === -1)
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
    _fs.appendFile(_outputLogFile, text + _os.EOL, function(err){
        if (err)
            console.log(err);
    });
}


/**
 * Renders the table showing all files found
 */
function fillFileTable(){
    const selectedFilter = document.querySelector('[name="filesTableFilter"]:checked').value;
    var allFiles = _fileDataCollection.find({ }),
        errors = 0,
        html = '';

    for (let file of allFiles){
        if (!file.isValid)
            errors ++;   

        if (selectedFilter === 'errors' && file.isValid)
            continue;

        let filePath = file.file,
            errorClass = file.isValid ? '' : 'allFilesTableRow--error';

        if (_storageRootFolder)
            filePath = filePath.substring(_storageRootFolder.length);

        html += `<li class="allFilesTableRow ${errorClass}">${filePath}</li>`;
    }

    _allFilesTable.innerHTML = html;

    _filesFoundCount.innerHTML = `Found ${allFiles.length ? allFiles.length : 'no'} files. `;;


    if (errors){
        _openLogLink.style.display = 'inline-block';
        _openLogLink.innerHTML = `View ${errors} errors`
    } else {
        _openLogLink.style.display = 'none';
    }

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

    if (!_storageRootFolder)
        return;

    _filesChanged = false;
    _busyReadingFiles = true;
    _errorsOccurred = false;
    _btnReindex.classList.add('button--disable');


    // clear output log
    _fs.writeFileSync(_outputLogFile, '');

    var processedCount = 0,
        allProperties = Object.keys(_allFiles),
        filesToProcessCount = allProperties.length;

    var intervalBusy = false;

    var timer = setInterval(function(){

        if (intervalBusy)
            return;

        intervalBusy = true;

        _busyReadingFiles = true;

        // check if all objects have been processed, if so write xml from loki and exit
        if (processedCount === filesToProcessCount - 1){
            _busyReadingFiles = false;
            _lokijsdb.saveDatabase();
            clearInterval(timer);
            setProgress('');
            generateXml();
            fillFileTable();
            intervalBusy = false;
            return;
        }

        var file = allProperties[processedCount];

        // ensure file exists, during deletes this list can be slow to update
        if (!_fs.existsSync(file)) {
            delete _allFiles[file];
            processedCount ++;
            intervalBusy = false;
            return;
        }

        // check if file data is cached in loki, and if file was updated since then
        var fileStats,
            fileCachedData = _fileDataCollection.by('file', file);

        if (fileCachedData){
            fileStats = _fs.statSync(file);
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
        _jsmediatags.read(file, {
            onSuccess: function(tag) {

                processedCount ++;

                if (tag.type === 'ID3' || tag.type === 'MP4'){
                    var fileNormalized = toUnixPaths(file);

                    fileCachedData.dirty = true;
                    fileCachedData.mtime = fileStats ? fileStats.mtime.toString() : '';
                    fileCachedData.tagData = {
                        name : tag.tags.title,
                        album : tag.tags.album,
                        track : tag.tags.track,
                        artist : tag.tags.artist,
                        clippedPath : toUnixPaths(fileNormalized.replace(_storageRootFolder, '/'))
                    };
                    fileCachedData.isValid = isTagValid( fileCachedData.tagData);

                    var percent = Math.floor(processedCount / filesToProcessCount * 100);
                    setProgress(`${percent}% : ${tag.tags.title} - ${tag.tags.artist}`);

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
        setStatus('');
        _btnReindex.classList.remove('button--disable');
        return;
    }

    setStatus('Indexing ... ');

    // force rebuild array, this tends to lag behind
    var allProperties = Object.keys(_allFiles),
        lineoutcount = 0,
        id3Array = [],
        XMLWriter = require('xml-writer'),
        writer = new XMLWriter();

    writer.startDocument();
    writer.startElement('items');
    writer.writeAttribute('date', new Date().getTime());

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

        // file isn't fully tagged - warn user about this
        if (!isTagValid(id3)){
            writeToLog(`${ id3.clippedPath} isn't properly tagged`);
            _errorsOccurred = true;
            continue;
        }

        writer.startElement('item');
        writer.writeAttribute('album', id3.album);
        writer.writeAttribute('artist', id3.artist);
        writer.writeAttribute('name', id3.name);
        writer.writeAttribute('path', id3.clippedPath);
        writer.endElement();

        setStatus(`Indexing ${lineoutcount} of ${id3Array.length}, ${id3.artist} ${id3.name}`);
    }

    writer.endElement();
    writer.endDocument();

    const xml = writer.toString(),
        indexPath = getIndexPath();

    _fs.writeFileSync(indexPath, xml);
    // write status data for fast reading
    let status = {
        date : new Date().getTime()
    }
    
    const statusPath = getStatusPath();
    _jsonfile.writeFileSync(statusPath, status);

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

    _lokijsdb.saveDatabase();

    setStatus('Indexing complete');
    _btnReindex.classList.remove('button--disable');
}


/**
 * Called when the "reindex now" button is clicked. Force rescans and reindexex everything. Does not directly trigger reindex, 
 * just queues all files as changed.
 */
function scanAllFiles (callback){
    if (_busyReadingFiles)
        return;
    _busyReadingFiles = true;

    var root = toUnixPaths(_storageRootFolder); 

    setStatus('Scanning files, this can take a while ... ');
    
    var globPaths = [];
    for (var i = 0; i < _watchedExtensions.length ; i ++)
        globPaths.push(_path.join(root, '**/*' + _watchedExtensions[i]));

    _glob(globPaths, { }, function(er, files) {
        if (er)
            throw er;

        setStatus('');

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
    _tray = new _Tray(__dirname + '/resources/windows/icon.ico');

    var contextMenu = _menu.buildFromTemplate([
        {label: 'Show', click:  function() {
            _mainWindow.show();
        } },
        {label: 'Quit', click:  function(){
            _electron.remote.app.isQuiting = true;
            _electron.remote.app.quit();

        } }
    ]);

    _tray.setToolTip('myStream.cc Indexer');
    _tray.setContextMenu(contextMenu);
}


function isTagValid(tag){
    return tag 
        && tag.album 
        && tag.artist 
        && tag.name;
}

/** 
 * The only place we set storageFolder.
 */
function setStorageRootFolder(folder){
    _storageRootFolder = folder;
    _config.set('storageRoot', folder);
}


function getIndexPath(){
    if (!_storageRootFolder)
        throw 'Invalid call - storage path not set';

    return _path.join(_storageRootFolder, '.myStream.xml');
}

function getStatusPath(){
    if (!_storageRootFolder)
        throw 'Invalid call - storage path not set';

    return _path.join(_storageRootFolder, '.myStream.json');
}

/**
 * Initialize watcher for file changes. This happens on app start, and when a new watch
 * folder is selected.
 */
function setStateBasedOnScanFolder(){
    // force defaults
    _scanFolderWrapper.style.visibility = 'hidden';
    _pathSelectedContent.style.visibility = 'hidden';
    _scanFolderWrapper.style.visibility = 'hidden';
    _noScanFolderContent.style.display = 'block';
    _scanFolderSelectedContent.style.display = 'none';

    if (!_storageRootFolder){
        //force wipe everything
        _fileDataCollection.clear();
        _lokijsdb.saveDatabase();


        fillFileTable();
        return;
    }

    _scanFolderSelectedContent.style.display = 'block';
    _noScanFolderContent.style.display = 'none';
    _pathSelectedContent.style.visibility = 'visible';
    _scanFolderWrapper.style.visibility = 'visible';
    _scanFolderDisplay.innerHTML = _storageRootFolder;

    scanAllFiles(function(){

        _watcher = _chokidar.watch([_storageRootFolder], {
            persistent: true,
            ignoreInitial : true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });
        
        // start watched for file changes
        _watcher
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