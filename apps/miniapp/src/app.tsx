import { Component } from 'react';
import type { PropsWithChildren } from 'react';
import { useUserStore } from './stores/userStore';
import { initCloud } from './lib/cloud';
import './app.scss';

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    initCloud();
    useUserStore.getState().initializeAuth().catch(console.error);
  }

  render() {
    return this.props.children;
  }
}

export default App;
