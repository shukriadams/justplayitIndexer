let element;

module.exports = function(fileArray, selectedFilter, errorCount){
    if (!element)
        element = document.querySelector('.filesFoundCount');

    if (selectedFilter === 'errors' && !errorCount)
        element.innerHTML = `No errors found`;
    else
        element.innerHTML = `Found ${fileArray.length ? fileArray.length : 'no'} files. `;
}