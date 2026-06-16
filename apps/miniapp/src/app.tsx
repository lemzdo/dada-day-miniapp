import { Component } from 'react';
import type { PropsWithChildren } from 'react';
import { useUserStore } from './stores/userStore';
import { initCloud } from './lib/cloud';
import { cleanupLegacyUserCaches } from './lib/legacyUserCacheCleanup';
import './app.scss';

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    void this.initializeApp();
  }

  private async initializeApp() {
    initCloud();
    try {
      await cleanupLegacyUserCaches();
    } catch (error) {
      console.warn('[app] legacy user cache cleanup failed', error);
    }
    useUserStore.getState().initializeAuth().catch(console.error);
  }

  render() {
    return this.props.children;
  }
}

export default App;
