/**
 * Wraps indexing logic. Repeatedly scans an instance of FileWatcher for file changes.
 * When changes are detected, gets files from FileWatcher and writes index data to disk.
 * 
 * Index data consists of four files 
 * 1 - an xml file containing all valid tagged music files
 * 2 - a small json file containing date when xml file was last written to
 * 3 - a text log of all errors
 * 4 - a lokijs database
 * 
 * The xml and json file are readable remotely via Dropbox / Nextcloud etc API, and are 
 * meant to be consumed by the Tuna server.
 * 
 * The text log is for local use - it's a quick-and-dirty way of reporting file read
 * errors to user. It will typically show files which are not propertly tagged.
 * 
 * The lokijs file is for local use - it keeps track of music files already read so we
 * don't have to continuously rescan all files on each time one file changes. We can also
 * query lokijs to display state on local UI.
 */
const 
    path = require('path')
    os = require('os')
    electron = require('electron')
    musicMetadata = require('music-metadata')
    pathHelper = require('./pathHelper')
    isTagValid = require('./istagValid')
    Lokijs = require('lokijs')
    hasha = require('hasha')
    fs = require('fs-extra')

module.exports = class {
    
    constructor(fileWatcher){
        this._fileWatcher = fileWatcher
        // callback for when status text is written
        this._onStatus = null
        // callback when indexing starts
        this._onIndexing = null
        // callback when indexing is done
        this._onIndexed = null
        this._interval
        this._busy = false
        this._errorsOccurred = false
        this._processedCount = 0
        this._toProcessCount = 0
        this._fileKeys = []
        // datetime of last index. read from json, or kept in memory
        this._lastIndexDate 
        this.genreDelimiter = ','
        // lokijs collection containing file data
        this._fileTable = null 
        this._logBuffer = []

        const dataFolder = path.join(electron.remote.app.getPath('appData'), 'tunaIndexer')

        this._lokijsPath = path.join(dataFolder, 'loki.json')
        this.logPath = path.join(dataFolder, 'output.log')
        this._loki = new Lokijs(this._lokijsPath)
    }

    async start(){

        // start new loki or load existing from file
        if (await fs.pathExists(this._lokijsPath))
           await this._loadLokiFromFile()
        else 
            this._createCollection()

        // start timer for observing file changes. We poll constantly
        // instead of responding to events from fileWatcher because we
        // often get many clustered events at once causing our event
        // watcher to clog. This can be made more effecient later
        this._interval= setInterval(async ()=>{
            await this._checkForFileChanges()
        }, 1000)
    }


    /**
     * Creates and sets loki table, to be used only on new loki file. if file already
     * exists, load table from file instaed
     */
    _createCollection(){
        this._fileTable = this._loki.addCollection('fileData',{ unique:['file']})
    }
   

    /**
     * Loads loki from file. if file is corrupt, destroys file and starts new collection
     */
    async _loadLokiFromFile(){
        return new Promise((resolve, reject)=>{
            try {
                this._loki.loadDatabase({}, async()=>{
                    
                    this._fileTable = this._loki.getCollection('fileData')

                    // if table load failed, file is corrupt, delete
                    if (!this._fileTable){
                        await fs.remove(this._lokijsPath)
                        this._createCollection()
                        console.log('loki file corrupt, resetting')
                    }

                    resolve()
                })
            }catch(ex){
                reject(ex)
            }
        })
    }

    async _checkForFileChanges(){

        // file watcher is where file state is kept
        if (!this._fileWatcher.dirty)
            return

        // already busy doing an index, exit
        if (this._busy)
            return

        this._busy = true

        // reset properties used for index state
        this._logBuffer = []
        this._fileWatcher.dirty = false
        this._errorsOccurred = false

        if (this._onIndexing)
            this._onIndexing()


        this._processedCount = -1
        this._fileKeys = Object.keys(this._fileWatcher.files)
        this._toProcessCount = this._fileKeys.length

        // start handling files
        this._handleNextFile()
    }


    /**
     * Stand-in fs.promises.stat which doesn't exist in current runtime 
     */
    async _stat(file){
        return new Promise((resolve, reject)=>{
            try {
                fs.stat(file,(err, stat)=>{
                    if (err)
                        return reject(err)

                    resolve(stat)
                })
            }catch(ex){
                reject(ex)
            }
        })
    }   


    /**
     * Checks each file on drive for changes. Compare actual file change
     * date with file data in Loki, if changed or not found, read its
     * id3 tags
     */
    async _handleNextFile(){
        setImmediate(async()=>{

            this._processedCount ++

            // check if all objects have been processed, if so write xml from loki and exit.
            // IMPORTANT : do not refactor this back into the try block, else
            // this method will recurse forever!
            if (this._processedCount >= this._toProcessCount){
                this._finishHandlingChanges()
                return
            }
            
            let insert = false

            try{
                
                let file = this._fileKeys[this._processedCount]

                // ensure file exists, during deletes this list can be slow to update
                if (!await fs.pathExists(file)) {
                    this._fileWatcher.remove(file)
                    return
                }

                // check if file data is cached in loki, and if file was updated since then
                let fileStats,
                    fileCachedData = this._fileTable.by('file', file)

                // file hasn't changed since last update, ignore it
                if (fileCachedData){
                    fileStats = await this._stat(file)
                    if (fileStats.mtime.toString() === fileCachedData.mtime)
                        return
                }
               
                if (!fileCachedData){
                    
                    fileCachedData = {
                        file : file
                    }

                    insert = true
                }

                let tag = await musicMetadata.parseFile(file)
                
                const fileNormalized = pathHelper.toUnixPath(file)
                
                let genres = ''
                if (tag.common.genre)
                    for (let genre of tag.common.genre)
                        genres += `${genre},`
                
                let modifiedTime = null;
                if (fileStats){
                    const btime = fileStats.birthtime ? new Date(fileStats.birthtime).getTime() : 0,
                        mtime = fileStats.mtime ? new Date(fileStats.mtime).getTime() : 0
                    
                    if (mtime > btime)
                        modifiedTime = mtime;
                    else if (btime > mtime)
                        modifiedTime = btime;
                }                        

                fileCachedData.dirty = true
                fileCachedData.mtime = modifiedTime
                fileCachedData.tagData = {
                    name : tag.common.title,
                    album : tag.common.album,
                    track : tag.common.track && tag.common.track.no ? tag.common.track.no : null,
                    artist : tag.common.artist,
                    year : tag.common.year || null,
                    genres,
                    clippedPath : fileNormalized.replace(pathHelper.toUnixPath(this._fileWatcher.watchPath), '')
                }

                fileCachedData.isValid = isTagValid( fileCachedData.tagData)

                const percent = Math.floor(this._processedCount / this._toProcessCount * 100)
                this._setStatus(`${percent}% ${tag.common.title} - ${tag.common.artist}`)

                if (insert)
                    this._fileTable.insert(fileCachedData)
                else
                    this._fileTable.update(fileCachedData)

            } catch(ex){
                let message

                if (ex.type && ex.type === 'tagfail')
                    message = `${file} tag read fail.`
                else 
                    message = `${file} could not be read, is it properly tagged?`

                fileCachedData.dirty = false
                fileCachedData.mtime = fileStats ? fileStats.mtime.toString() : null
                fileCachedData.tagData  = null

                if (insert)
                    this._fileTable.insert(fileCachedData)
                else
                    this._fileTable.update(fileCachedData)

                this._logBuffer.push(`${message} : ${JSON.stringify(ex)}`)
                this._errorsOccurred = true
            } finally{
                this._handleNextFile()
            }
        })
    }


    /**
     * Called after all files have been read. Updates Loki with file state.
     * If any file changes were detected, writes a totally new XML index file.
     */
    async _finishHandlingChanges(){
        try {
            this._loki.saveDatabase()
    
            // check for dirty files in loki. If nothing, indexing is done
            const dirty =  this._fileTable.find({dirty : true})
            if (!dirty.length){
                if (this._processedCount)
                    this._setStatus(`No changes detected`)
                else
                    this._setStatus('Found no music')
                    
                return
            }
    
            this._setStatus('Indexing ... ')
    
            // force rebuild files key incase we needed to delete items along the way
            let allProperties = Object.keys(this._fileWatcher.files),
                writer = ''


            // filter out files that won't be index
            let filesToIndex = [];
            for (let i = 0 ; i < allProperties.length ; i ++) {
    
                const fileData = this._fileTable.by('file', allProperties[i])
                if (!fileData)
                    // yeah, this should never happen
                    continue 
    
                if (!fileData.tagData){
                    this._logBuffer.push(`${allProperties[i]} has no tag data`)
                    continue
                }
    
                const id3 = fileData.tagData
    
                // file isn't fully tagged - warn user about this
                if (!isTagValid(id3)){
                    this._logBuffer.push(`${ id3.clippedPath} isn't properly tagged`)
                    this._errorsOccurred = true
                    continue
                }

                filesToIndex.push(fileData)
            }            

            const hash = hasha(JSON.stringify(filesToIndex), {algorithm: 'md5' })


            writer += `${JSON.stringify({ date : new Date().getTime(), hash })}\n` 
            
            for (let i = 0 ; i < filesToIndex.length ; i ++) {
    
                const fileData = filesToIndex[i]

                writer += `${JSON.stringify({ 
                    album : fileData.tagData.album,
                    artist : fileData.tagData.artist,
                    name : fileData.tagData.name,
                    path : fileData.tagData.clippedPath,
                    year : fileData.tagData.year,
                    track : fileData.tagData.track,
                    genres: fileData.tagData.genres,
                    modified : fileData.mtime || null
                })}\n` 
                
                this._setStatus(`Indexing ${i} of ${filesToIndex.length}, ${fileData.tagData.artist} ${fileData.tagData.name}`)
            }
    
            const indexPath = pathHelper.getIndexPath(this._fileWatcher.watchPath)
            await fs.outputFile(indexPath, writer)
    
            // write status data for fast reading
            this._lastIndexDate = new Date()

            let status = {
                hash,
                date : this._lastIndexDate.getTime()
            }
            
            const statusPath = pathHelper.getStatusPath(this._fileWatcher.watchPath)
            await fs.outputJson(statusPath, status)
    
            // clean dirty records
            for (let i = 0 ; i < dirty.length ; i ++){
                let record = dirty[i]
                record.dirty = false
                this._fileTable.update(record)
            }
    
            // find orphans
            let orphans = this._fileTable.where(r =>{
                return allProperties.indexOf(r.file) === -1
            });

            // remove orphans
            for (let i = 0 ; i < orphans.length ; i ++) 
                this._fileTable.remove(orphans[i])
            

            // write output log, we do this here to ensure that log contains actual changes, else a rescan
            // with no resulting changes can overwrite an earlier useful log
            await fs.outputFile(this.logPath, this._logBuffer.join(os.EOL))

            this._loki.saveDatabase()

        } finally{
            if (this._onIndexed)
                this._onIndexed()

            this._busy = false
        }

        this._setStatus('Indexing complete')

    }   


    /**
     * Gets date last index was written, from status file 
     */
    async getLastIndexDate(){
        if (!this._lastIndexDate){
            
            const statusFilePath = pathHelper.getStatusPath(this._fileWatcher.watchPath)

            if (await fs.pathExists(statusFilePath)){
                try{
                    this._lastIndexDate = new Date((await fs.readJson(statusFilePath)).date)
                } catch(ex){
                    // status file corrupt, do nothing and wait for it to be written again
                }
            }
        }

        return this._lastIndexDate
    }

    /**
     * Destroys all index files on disk
     */
    async wipe(){
        await fs.remove(pathHelper.getIndexPath(this._fileWatcher.watchPath))

        await fs.remove(pathHelper.getStatusPath(this._fileWatcher.watchPath))

        this._fileTable.clear()
        this._loki.saveDatabase()
    }


    /**
     * Gets a list of all files currently indexed. list is pulled via Loki,
     * not from drive
     */
    getAllFiles(){
        return this._fileTable.find({ })
    }

    onIndexing(callback){
        this._onIndexing = callback
    }

    onIndexed(callback){
        this._onIndexed = callback
    }

    onStatus(callback){
        this._onStatus = callback
    }
  
    _setStatus(status){
        if (this._onStatus)
           this._onStatus(status)
    }

    dispose(){
        if (this._interval)
            clearInterval(this._interval)
    }
}