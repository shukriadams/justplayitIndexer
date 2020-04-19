const   
    path = require('path');

module.exports = {
    toUnixPath(path){
        return path.replace(/\\/g, '/'); 
    },

    getIndexPath(storageRootFolder){
        if (!storageRootFolder)
            throw 'Invalid call - storage path not set';
    
        return path.join(storageRootFolder, '.myStream.xml');
    },

    getStatusPath(storageRootFolder){
        if (!storageRootFolder)
            throw 'Invalid call - storage path not set';
    
        return path.join(storageRootFolder, '.myStream.json');
    }
}