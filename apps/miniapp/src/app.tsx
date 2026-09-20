import { Component } from 'react';
import type { PropsWithChildren } from 'react';
import { useUserStore } from './stores/userStore';
import { initCloud } from './lib/cloud';
import { runPostAuthStorageMigration, runPreAuthStorageMigration } from './lib/storageMigration';
import './app.scss';

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    void this.initializeApp();
  }

  private async initializeApp() {
    initCloud();
    try {
      runPreAuthStorageMigration();
    } catch (error) {
      console.warn('[app] pre-auth storage migration failed', error);
    }
    useUserStore.getState().initializeAuth()
      .then(() => {
        const userScope = useUserStore.getState().userScope;
        if (userScope) runPostAuthStorageMigration(userScope);
      })
      .catch(console.error);
  }

  render() {
    return this.props.children;
  }
}

export default App;
