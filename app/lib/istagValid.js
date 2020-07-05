module.exports = function isTagValid(tag){
    return !!tag 
        && !!tag.album 
        && !!tag.artist 
        && !!tag.name;
}