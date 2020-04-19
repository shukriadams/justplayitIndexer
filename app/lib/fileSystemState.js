/**
 * Single view of music files on local drive, based on what our watcher is seeing.
 * Music files are scanned with glob and then stored in a hash table which is
 * exposed to rest of app.
 * Chokidar watches file system and keeps this hash table up-to-date. 
 */
const 
   path = require('path'),
   glob = require('multi-glob').glob,
   chokidar = require('chokidar'),
   pathHelper = require('./pathHelper');

module.exports = class {

   /**
    * 
    * @param {*} watchPath Path on disk to scan for files
    */
   constructor(watchPath){
      // hash table of exposed files
      this.files = {};
      this.dirty = false; // set to true if files are changed
      this.watchedExtensions = ['.mp3', '.m4a']; // todo : expose as setting
      this.watchPath = watchPath;
      this.chokidar = null;
      this._busyScanning = false;
   }

   /**
    * Starts scanning for changes in files. 
    */
   async start(){
      // do full scan first so we have state that can change
      await this.rescan();

      this.chokidar = chokidar.watch([this.watchPath], {
         persistent: true,
         ignoreInitial : true,
         awaitWriteFinish: {
             stabilityThreshold: 2000,
             pollInterval: 100
         }
     });
     
     // start watched for file changes
     this.chokidar
         .on('add', p =>{
            this._registerFileChange(p, 'add');
         })
         .on('change', p =>{
            this._registerFileChange(p, 'change');
         })
         .on('unlink', p =>{
            this._registerFileChange(p, 'delete');
         });
   }

   /**
    * Internal use only, handles per-file change detected by chokidar
    * @param {*} file Full path of file changed
    * @param {*} changeType String descripting action add|change|delete
    */
   _registerFileChange(filePath, changeType){
      const extension = path.extname(filePath);
      
      // ignore change if coming from a file type we don't care about
      if (this.watchedExtensions.indexOf(extension) === -1)
          return;
  
      if (changeType === 'delete')
          delete this.files[filePath];
      else{
         this.files[filePath] = this.files[filePath] || {};
         this.files[filePath].file = filePath;
      }
  
      this.dirty = true;
   }

   /**
    * Exposes a "files changed" event to whatever needs to subscribe to this.
    * @param {*} callback 
    */
   onFilesChanged(callback){

   }


   /**
    * Sometimes a file is deleted from FS before being deleted from watched.
    * Use this to remove known deleted files
    */
   remove(file){
      delete this.files[file];
   }


   /**
    * Rescans files. Exposed to allow for manual rescanning.
    */
   async rescan(){
      return new Promise((resolve, reject)=>{
         try {
            if (this._busyScanning)
               return resolve();
   
            this._busyScanning = true;
      
            var root = pathHelper.toUnixPath(this.watchPath); 
      
            // setStatus('Scanning files, this can take a while ... ');
            
            var globPaths = [];
            for (var i = 0; i <  this.watchedExtensions.length ; i ++)
               globPaths.push(path.join(root, '**/*' + this.watchedExtensions[i]));
      
            glob(globPaths, { }, (er, files)=>{
               if (er)
                  return reject(er);
      
               // setStatus('');
      
               this.files = {};
               for (var i = 0 ; i < files.length ; i ++)
                  this.files[files[i]] = {
                     file : files[i] 
                  };
      
               this._busyScanning = false;
               resolve();
            });
         } catch(ex){
            reject(ex);
            this._busyScanning = false;
         } 
      })

   }
 }