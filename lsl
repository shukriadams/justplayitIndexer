[1mdiff --git a/app/app.html b/app/app.html[m
[1mindex 253d011..152ef29 100644[m
[1m--- a/app/app.html[m
[1m+++ b/app/app.html[m
[36m@@ -42,6 +42,7 @@[m
             </div>[m
 [m
             <div class="outputLog"></div>[m
[32m+[m[32m            <a class="openLog">View errors</a>[m
         </div>[m
     </body>[m
 [m
[1mdiff --git a/app/indexer.js b/app/indexer.js[m
[1mindex 32595ca..e7fc40c 100644[m
[1m--- a/app/indexer.js[m
[1m+++ b/app/indexer.js[m
[36m@@ -5,6 +5,7 @@[m [mvar path = require('path'),[m
     chokidar = require('chokidar'),[m
     AutoLaunch = require('auto-launch'),[m
     fs = require('fs'),[m
[32m+[m[32m    os = require('os'),[m
     electron = require('electron'),[m
     Config = require('electron-config'),[m
     lokijs = require('lokijs'),[m
[36m@@ -19,6 +20,7 @@[m [mvar path = require('path'),[m
     scanFolderWrapper = document.querySelector('.scanFolderWrapper'),[m
     filesFoundCount = document.querySelector('.filesFoundCount'),[m
     outputLog = document.querySelector('.outputLog'),[m
[32m+[m[32m    openLogLink = document.querySelector('.openLog'),[m
 [m
     lokijsPath = path.join(__dirname, 'persist.json'),[m
     lokijsdb = new lokijs(lokijsPath),[m
[36m@@ -38,7 +40,8 @@[m [mvar path = require('path'),[m
     _scanFolder = config.get('scanFolder'),[m
     _dropboxFolder = config.get('dropboxRoot'),[m
     _isAutostarting = config.get('autoStart'),[m
[31m-    _tray = null;[m
[32m+[m[32m    _errorsOccurred = false,[m
[32m+[m[32m    _tray = null;[m[41m    [m
 [m
 // starts everything[m
 var mode ='';[m
[36m@@ -119,6 +122,10 @@[m [mfunction onLokiReady(){[m
             autoLaunch.disable();[m
     });[m
 [m
[32m+[m[32m    openLogLink.addEventListener('click', function(){[m
[32m+[m[32m        electron.shell.openItem(outputLogFile);[m
[32m+[m[32m    });[m
[32m+[m
     btnReindex.addEventListener('click', function() {[m
         _fileDataCollection.clear(); // force flush collection[m
         lokijsdb.saveDatabase();[m
[36m@@ -250,17 +257,7 @@[m [mfunction registerFileChange(file, action){[m
  * starts.[m
  */[m
 function writeToLog(text){[m
[31m-    fs.appendFileSync(outputLogFile, text + '\r\n');[m
[31m-}[m
[31m-[m
[31m-[m
[31m-/**[m
[31m- * Writes error to screen.[m
[31m- **/[m
[31m-function writeOutputLog(text){[m
[31m-    var row = document.createElement('div');[m
[31m-    row.innerHTML = text;[m
[31m-    outputLog.insertBefore(row, outputLog.firstChild);[m
[32m+[m[32m    fs.appendFileSync(outputLogFile, text + os.EOL);[m
 }[m
 [m
 [m
[36m@@ -281,8 +278,10 @@[m [mfunction handleFileChanges(){[m
 [m
     _filesChanged = false;[m
     _busyReadingFiles = true;[m
[32m+[m[32m    _errorsOccurred = false;[m
     btnReindex.style.display = 'none';[m
     outputLog.innerHTML = '';[m
[32m+[m[32m    openLogLink.style.display = 'none';[m
 [m
     if (_dropboxFolder === null){[m
         setCurrentAction('The path you selected is not within a Dropbox folder.');[m
[36m@@ -396,8 +395,8 @@[m [mfunction handleFileChanges(){[m
                 else[m
                     _fileDataCollection.update(fileCachedData);[m
 [m
[31m-                writeOutputLog(message);[m
                 writeToLog(message + ' : ' + JSON.stringify(error));[m
[32m+[m[32m                _errorsOccurred = true;[m
                 intervalBusy = false;[m
             }[m
         }); // timer function[m
[36m@@ -424,8 +423,6 @@[m [mfunction generateXml(){[m
         btnReindex.style.display = 'inline';[m
         return;[m
     }[m
[31m-    [m
[31m-    console.log('dirty files ' + dirty.length);[m
 [m
     setCurrentAction('Indexing ... ');[m
 [m
[36m@@ -495,6 +492,9 @@[m [mfunction generateXml(){[m
 [m
     setCurrentAction('New index file written. Watching for changes ...');[m
     btnReindex.style.display = 'inline';[m
[32m+[m
[32m+[m[32m    if (_errorsOccurred)[m
[32m+[m[32m        openLogLink.style.display = 'block';[m
 }[m
 [m
 /**[m
[1mdiff --git a/app/main.css b/app/main.css[m
[1mindex 53b510f..7cbf8bd 100644[m
[1m--- a/app/main.css[m
[1m+++ b/app/main.css[m
[36m@@ -44,6 +44,11 @@[m [mh2 {[m
     font-weight: bold;[m
 }[m
 [m
[32m+[m[32m.openLog{[m
[32m+[m[32m    cursor: pointer;[m
[32m+[m[32m    display: none;[m
[32m+[m[32m}[m
[32m+[m
 .pathSelectedContent,[m
 .scanFolderWrapper {[m
     display: none;[m
[1mdiff --git a/app/package.json b/app/package.json[m
[1mindex 5a14750..edbf98d 100644[m
[1m--- a/app/package.json[m
[1m+++ b/app/package.json[m
[36m@@ -10,7 +10,7 @@[m
   "main": "background.js",[m
   "dependencies": {[m
     "auto-launch" : "5.0.1",[m
[31m-    "lokijs" : "1.4.1",[m
[32m+[m[32m    "lokijs" : "1.5.5",[m
     "electron-config" : "0.2.1",[m
     "fs-jetpack": "^0.9.0",[m
     "jsmediatags" : "3.8.1",[m
