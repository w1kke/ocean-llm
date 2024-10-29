# ocean-llm
Interact with Ocean Protocol libraries via a LLM

## Installing Ocean LLM

To install Ocean LLM, follow these steps:

1. Clone the repository
   ```
   git clone https://github.com/w1kke/ocean-llm.git
   ```
2. Navigate to the project directory
   ```
   cd ocean-llm
   ```
3. Install the dependencies
   ```
   npm install
   ```
4. Configure environment variables
   ```
   cp .env.example .env
   ```
   Then edit the `.env` file with your configuration (see Environment Variables section below)

5. Start the server
   ```
   npm start
   ```
6. Open your browser and navigate to http://localhost:3000

## Environment Variables Configuration

The application uses environment variables for configuration. A `.env.example` file is provided as a template. To configure your environment:

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Edit the `.env` file with your specific configuration

### Required Variables

#### LLM API Configuration
You must provide either an OpenAI API key OR an OpenRouter API key:

**Option 1: OpenAI**
```
OPENAI_API_KEY=your_openai_api_key_here
```

**Option 2: OpenRouter**
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_REFERER=http://localhost:3000
OPENROUTER_TITLE=Ocean LLM App
```

#### Ocean Protocol Configuration
```
OCEAN_NETWORK_URL=your_network_url_here
PROVIDER_URL=your_provider_url_here
AQUARIUS_URL=your_aquarius_url_here
```

#### Server Configuration
```
PORT=3000  # Optional, defaults to 3000 if not set
```

### Notes
- Never commit your `.env` file to version control
- The `.env.example` file serves as a template and should not contain actual credentials
- If both OpenAI and OpenRouter keys are provided, the application will default to using OpenAI
- Make sure to set appropriate values for OPENROUTER_REFERER and OPENROUTER_TITLE when using OpenRouter
