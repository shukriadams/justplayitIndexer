module.exports = {
    toUnixPath(path){
        return path.replace(/\\/g, '/'); 
    }
}