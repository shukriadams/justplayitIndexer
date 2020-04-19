let
    electron = require('electron'),
    element;

module.exports = function(errorCount, logPath){
    if (!element){
        element = document.querySelector('.openLog');
        element.addEventListener('click', function(){
            electron.shell.openItem(logPath);
        });
    }

    if (errorCount){
        element.style.display = 'inline-block';
        element.innerHTML = `View ${errorCount} errors`
    } else {
        element.style.display = 'none';
    }
}