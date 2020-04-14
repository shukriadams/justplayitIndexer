(function(){
    'use strict';

    for (let tabControl of document.querySelectorAll('.glu_verticalTabs'))
        initialize(tabControl);

    function initialize(tabControl){
        // auto display first tab control
        const tab = tabControl.querySelector('.glu_verticalTabs-tab');
        if (!tab)
            return;

        focusTab(tab);
    }

    function focusTab(tab){
        const tabId = tab.getAttribute('data-tab');
        if (!tabId)
            return;

        const tabControl = tab.parentElement.parentElement;
        
        // remove
        for (let anyTab of tabControl.querySelectorAll('.glu_verticalTabs-tab'))
            anyTab.classList.remove('glu_verticalTabs-tab--active');

        tab.classList.add('glu_verticalTabs-tab--active');

        for (var panel of tabControl.querySelectorAll('.glu_verticalTabs-panel'))
            panel.classList.remove('glu_verticalTabs-panel--visible');

        const focusPanel = tabControl.querySelector(`.glu_verticalTabs-panel[data-tab="${tabId}"]`);
        if (!focusPanel)
            console.error(`.glu_verticalTabs-panel[data-tab=${tabId}] not found`);
        
        focusPanel.classList.add('glu_verticalTabs-panel--visible');
    }

    document.addEventListener('click', function(e){
        if (!e.target.classList.contains('glu_verticalTabs-tab'))
            return;

            focusTab(e.target);
    }, false);
})()
