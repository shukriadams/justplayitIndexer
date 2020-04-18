(function(){

    'use strict';

    class TabControl{

        constructor(tabControl){
            this.tabControl = tabControl;

            // bind to window by id
            const tabUniqueId = tabControl.getAttribute('id');
            if (tabUniqueId){
                window.__glu_verticalTabs = window.__glu_vericalTabs || {};
                window.__glu_verticalTabs[tabUniqueId] = this;
            }

            this.focusFirst();
            this.bindEvents();
        }

        bindEvents(){
            for (let tab of this.tabControl.querySelectorAll('.glu_verticalTabs-tab')){
                (tab =>{
                    tab.addEventListener('click',e =>{
                        this.focusTab(tab);
                    }, false);
                })(tab)
            }

        }

        /**
         * auto display first tab control
         */
        focusFirst(){
            const tab = this.tabControl.querySelector('.glu_verticalTabs-tab');
            if (!tab)
                return;

            this.focusTab(tab);
        }


        /**
         * 
         */
        focusNamed(tabName){
            const tab = this.tabControl.querySelector(`.glu_verticalTabs-tab[data-tab="${tabName}"]`);
            if (!tab)
                return;

            this.focusTab(tab);
        }


        /**
         * Focuses a tab
         */
        focusTab(tab, tabControl){
            const tabId = tab.getAttribute('data-tab');
            if (!tabId)
                return;

            // remove
            for (let anyTab of this.tabControl.querySelectorAll('.glu_verticalTabs-tab'))
                anyTab.classList.remove('glu_verticalTabs-tab--active');
    
            tab.classList.add('glu_verticalTabs-tab--active');
    
            for (var panel of this.tabControl.querySelectorAll('.glu_verticalTabs-panel'))
                panel.classList.remove('glu_verticalTabs-panel--visible');
    
            const focusPanel = this.tabControl.querySelector(`.glu_verticalTabs-panel[data-tab="${tabId}"]`);
            if (!focusPanel)
                console.error(`.glu_verticalTabs-panel[data-tab=${tabId}] not found`);
            
            focusPanel.classList.add('glu_verticalTabs-panel--visible');
        }
    }


    // initialize
    for (let tabControl of document.querySelectorAll('.glu_verticalTabs')){
        new TabControl(tabControl);
    }

})()
