let element;

module.exports = function(fileArray){
    if (!element)
        element = document.querySelector('.filesFoundCount');

    element.innerHTML = `Found ${fileArray.length ? fileArray.length : 'no'} files. `;
}