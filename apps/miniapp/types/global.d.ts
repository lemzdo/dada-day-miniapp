/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.scss';
declare module '*.sass';

declare const defineAppConfig: <T>(config: T) => T;
declare const definePageConfig: <T>(config: T) => T;
