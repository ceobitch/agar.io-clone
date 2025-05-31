const webpack = require('webpack');

module.exports = (isProduction) => ({
    entry: "./src/client/js/app.js",
    mode: isProduction ? 'production' : 'development',
    output: {
        library: "app",
        filename: "app.js"
    },
    devtool: isProduction ? false : 'source-map',
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            '@babel/preset-env',
                            ['@babel/preset-react', {
                                runtime: 'automatic'
                            }]
                        ]
                    }
                }
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    resolve: {
        extensions: ['.js', '.jsx'],
        alias: {
            'process/browser': require.resolve('process/browser')
        },
        fallback: {
            "crypto": require.resolve('crypto-browserify'),
            "stream": require.resolve('stream-browserify'),
            "buffer": require.resolve('buffer'),
            "assert": require.resolve('assert'),
            "http": require.resolve('stream-http'),
            "https": require.resolve('https-browserify'),
            "os": require.resolve('os-browserify/browser'),
            "url": require.resolve('url'),
            "process": require.resolve('process/browser'),
            "vm": false
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: ['process/browser'],
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
        })
    ]
});
