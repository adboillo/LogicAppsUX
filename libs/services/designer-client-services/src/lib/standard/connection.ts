import type { BaseConnectionServiceOptions } from '../base';
import { BaseConnectionService } from '../base';
import { apiManagementConnectorId, azureFunctionConnectorId } from '../base/operationmanifest';
import type { HttpResponse } from '../common/exceptions';
import type { ConnectionCreationInfo, ConnectionParametersMetadata, CreateConnectionResult, IConnectionService } from '../connection';
import type { IHttpClient } from '../httpClient';
import { LoggerService } from '../logger';
import { LogEntryLevel, Status } from '../logging/logEntry';
import type { IOAuthPopup } from '../oAuth';
import { OAuthService } from '../oAuth';
import { getIntl } from '@microsoft/intl-logic-apps';
import type { Connection, ConnectionParameter, Connector, ManagedIdentity } from '@microsoft/utils-logic-apps';
import {
  ArgumentException,
  AssertionErrorCode,
  AssertionException,
  ConnectionParameterSource,
  ConnectionType,
  ResourceIdentityType,
  equals,
  optional,
  isArmResourceId,
  isIdentityAssociatedWithLogicApp,
  safeSetObjectPropertyValue,
  createCopy,
} from '@microsoft/utils-logic-apps';

interface ConnectionAcl {
  id: string;
  location: string;
  name: string;
  properties: {
    principal: {
      type: string;
      identity: {
        objectId: string;
        tenantId: string;
      };
    };
  };
  type: string;
}

interface ServiceProviderConnectionModel {
  parameterValues: Record<string, any>;
  serviceProvider: {
    id: string;
  };
  parameterSetName?: string;
  displayName?: string;
}

interface FunctionsConnectionModel {
  function: {
    id: string;
  };
  triggerUrl: string;
  authentication: {
    type: string;
    name: string;
    value: string;
  };
  displayName?: string;
}

interface APIManagementConnectionModel {
  apiId: string;
  baseUrl: string;
  subscriptionKey: string;
  authentication?: {
    type: string;
    name: string;
    value: string;
  };
  displayName?: string;
}

interface ConnectionAndAppSetting<T> {
  connectionKey: string;
  connectionData: T;
  settings: Record<string, string>;
  pathLocation: string[];
}

interface ConnectionsData {
  managedApiConnections?: any;
  serviceProviderConnections?: Record<string, ServiceProviderConnectionModel>;
  functionConnections?: Record<string, FunctionsConnectionModel>;
  apiManagementConnections?: Record<string, APIManagementConnectionModel>;
}

type LocalConnectionModel = FunctionsConnectionModel | ServiceProviderConnectionModel | APIManagementConnectionModel;
type ReadConnectionsFunc = () => Promise<ConnectionsData>;
type WriteConnectionFunc = (connectionData: ConnectionAndAppSetting<LocalConnectionModel>) => Promise<void>;

const serviceProviderLocation = 'serviceProviderConnections';
const functionsLocation = 'functionConnections';
const apimLocation = 'apiManagementConnections';

export interface StandardConnectionServiceOptions {
  apiVersion: string;
  baseUrl: string;
  httpClient: IHttpClient;
  apiHubServiceDetails: BaseConnectionServiceOptions;
  workflowAppDetails?: {
    appName: string;
    identity?: ManagedIdentity;
  };
  readConnections: ReadConnectionsFunc;
  writeConnection?: WriteConnectionFunc;
  connectionCreationClients?: Record<string, ConnectionCreationClient>;
}

type CreateConnectionFunc = (connectionInfo: ConnectionCreationInfo, connectionName: string) => Promise<ConnectionCreationInfo>;

interface ConnectionCreationClient {
  connectionCreationFunc: CreateConnectionFunc;
}

export class StandardConnectionService extends BaseConnectionService implements IConnectionService {
  constructor(private readonly _options: StandardConnectionServiceOptions) {
    super(_options.apiHubServiceDetails);
    const { apiHubServiceDetails, readConnections } = _options;
    if (!readConnections) {
      throw new ArgumentException('readConnections required');
    } else if (!apiHubServiceDetails) {
      throw new ArgumentException('apiHubServiceDetails required for workflow app');
    }

    this._vVersion = 'V2';
  }

  async getConnector(connectorId: string): Promise<Connector> {
    if (connectorId === '/providers/Microsoft.PowerApps/apis/shared_uiflow') {
      console.log('getConnector', connectorId);
      // return {
      //   id: '/providers/Microsoft.PowerApps/apis/shared_uiflow',
      //   name: 'shared_uiflow',
      //   type: 'Microsoft.ProcessSimple/apis/apiOperations',
      //   properties: {
      //     displayName: 'Desktop flows',
      //     iconUri: 'https://connectoricons-df.azureedge.net/releases/v1.0.1649/1.0.1649.3368/uiflow/icon.png',
      //   },
      // };
      return {
        name: 'shared_uiflow',
        id: '/providers/Microsoft.PowerApps/apis/shared_uiflow',
        type: 'Microsoft.PowerApps/apis',
        properties: {
          displayName: 'Desktop flows',
          iconUri: 'https://connectoricons-df.azureedge.net/releases/v1.0.1649/1.0.1649.3368/uiflow/icon.png',
          iconBrandColor: '#0066FF',
          apiEnvironment: 'Shared',
          isCustomApi: false,
          connectionParameterSets: {
            uiDefinition: {
              displayName: 'Connect',
              description: 'Type of connection to be used',
            },
            values: [
              {
                name: 'azureRelay',
                uiDefinition: {
                  displayName: 'Connect with username and password',
                  description: 'Connect with username and password',
                },
                parameters: {
                  targetId: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Machine or machine group',
                      description: 'Select the machine or machine group to connect to',
                      tooltip: 'Select the machine or machine group to connect to',
                      constraints: {
                        tabIndex: 1,
                        required: 'true',
                      },
                    },
                  },
                  username: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Domain and username',
                      description: 'Format as domain\\username or username@domain.com',
                      credentialMapping: {
                        mappingName: 'WindowsCredentials',
                        displayName: 'Windows Credential (preview)',
                        tooltip: 'Windows Credential',
                        values: [
                          {
                            type: 'UserPassword',
                            credentialKeyName: 'UsernameKey',
                          },
                          {
                            type: 'UserPasswordList',
                            credentialKeyName: 'UsernameArray',
                          },
                        ],
                      },
                      tooltip: 'Username credential',
                      constraints: {
                        tabIndex: 2,
                        clearText: true,
                        required: 'true',
                      },
                    },
                  },
                  password: {
                    type: 'securestring',
                    uiDefinition: {
                      displayName: 'Password',
                      description: 'Password credential',
                      tooltip: 'Password credential',
                      credentialMapping: {
                        mappingName: 'WindowsCredentials',
                        displayName: 'Windows Credential (preview)',
                        tooltip: 'Windows Credential',
                        values: [
                          {
                            type: 'UserPassword',
                            credentialKeyName: 'PasswordKey',
                          },
                          {
                            type: 'UserPasswordList',
                            credentialKeyName: 'PasswordArray',
                          },
                        ],
                      },
                      constraints: {
                        tabIndex: 3,
                        required: 'true',
                      },
                    },
                  },
                  environment: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Environment id',
                      description: 'Environment id',
                      tooltip: 'Environment id',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  xrmInstanceUri: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'XRM instance uri',
                      description: 'The XRM instance uri',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  agentPort: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Agent Http Port',
                      description: 'The agent http port',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                  encryptedCredentials: {
                    type: 'securestring',
                    uiDefinition: {
                      displayName: 'Encrypted credentials',
                      description: 'Encrypted credentials',
                      tooltip: 'Encrypted credentials',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  primaryEncryptingKeyId: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Encrypting key id',
                      description: 'Encrypting key id',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                  secondaryEncryptedCredentials: {
                    type: 'securestring',
                    uiDefinition: {
                      displayName: 'Secondary encrypted credentials',
                      description: 'Secondary encrypted credentials',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                  secondaryEncryptingKeyId: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Encrypting key id',
                      description: 'Encrypting key id',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                  connectionType: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Connection Type',
                      description: 'Connection Type',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                },
                metadata: {
                  allowSharing: false,
                },
              },
              {
                name: 'passwordlessAttended',
                uiDefinition: {
                  displayName: 'Connect with sign in - Attended (preview)',
                  description: 'Connect with sign in - Attended (preview)',
                },
                parameters: {
                  targetId: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Machine or machine group',
                      description: 'Select the machine or machine group to connect to',
                      tooltip: 'Select the machine or machine group to connect to',
                      constraints: {
                        tabIndex: 1,
                        required: 'true',
                      },
                    },
                  },
                  environment: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Environment id',
                      description: 'Environment id',
                      tooltip: 'Environment id',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  xrmInstanceUri: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'XRM instance uri',
                      description: 'The XRM instance uri',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  token: {
                    type: 'oauthSetting',
                    oAuthSettings: {
                      identityProvider: 'aadcertificate',
                      clientId: '7a65d264-a9f6-4625-878f-90f77e1bbb24',
                      scopes: [],
                      redirectMode: 'GlobalPerConnector',
                      redirectUrl: 'https://global-test.consent.azure-apim.net/redirect/uiflow',
                      properties: {
                        IsFirstParty: 'True',
                        AzureActiveDirectoryResourceId: 'https://api.test.powerplatform.com/',
                        IsOnbehalfofLoginSupported: true,
                      },
                      customParameters: {
                        resourceUri: {
                          value: 'https://api.test.powerplatform.com/',
                        },
                        loginUri: {
                          value: 'https://login.windows.net',
                        },
                        loginUriAAD: {
                          value: 'https://login.windows.net',
                        },
                      },
                    },
                    uiDefinition: {
                      displayName: 'Sign in with your Azure Active Directory credentials',
                      description: 'Sign in with your Azure Active Directory credentials',
                      tooltip: 'Provide  Azure Active Directory credentials',
                      constraints: {
                        required: 'true',
                      },
                    },
                  },
                  connectionType: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Connection Type',
                      description: 'Connection Type',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                },
                metadata: {
                  allowSharing: false,
                },
              },
              {
                name: 'onPremisesDataGateway',
                uiDefinition: {
                  displayName: 'Using an on-premises data gateway (deprecated)',
                  description: 'Use an on-premises data gateway',
                },
                parameters: {
                  gateway: {
                    type: 'gatewaySetting',
                    gatewaySettings: {
                      dataSourceType: 'CustomConnector',
                      credentialType: 'Basic',
                      connectionDetails: [],
                    },
                    uiDefinition: {
                      displayName: 'Gateway name',
                      description: 'Select the on-premises gateway to connect to',
                      tooltip: 'Select the on-premises gateway to connect to',
                      constraints: {
                        tabIndex: 1,
                        required: 'true',
                      },
                    },
                  },
                  username: {
                    type: 'securestring',
                    uiDefinition: {
                      displayName: 'Domain and username',
                      description: 'Format as domain\\username or username@domain.com',
                      tooltip: 'Username credential',
                      constraints: {
                        tabIndex: 2,
                        clearText: true,
                        required: 'true',
                        capability: ['gateway'],
                      },
                    },
                  },
                  password: {
                    type: 'securestring',
                    uiDefinition: {
                      displayName: 'Password',
                      description: 'Password credential',
                      tooltip: 'Password credential',
                      constraints: {
                        tabIndex: 3,
                        required: 'true',
                        capability: ['gateway'],
                      },
                    },
                  },
                  environment: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Environment id',
                      description: 'Environment id',
                      tooltip: 'Environment id',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  xrmInstanceUri: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'XRM instance uri',
                      description: 'The XRM instance uri',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                      },
                    },
                  },
                  authType: {
                    type: 'string',
                    allowedValues: [
                      {
                        value: 'windows',
                      },
                      {
                        value: 'basic',
                      },
                    ],
                    uiDefinition: {
                      displayName: 'Authentication Type',
                      description: 'The authentication type',
                      tooltip: 'Authentication type',
                      constraints: {
                        required: 'true',
                        hidden: 'true',
                        allowedValues: [
                          {
                            text: 'windows',
                            value: 'windows',
                          },
                          {
                            text: 'basic',
                            value: 'basic',
                          },
                        ],
                        capability: ['gateway'],
                      },
                    },
                  },
                  agentPort: {
                    type: 'string',
                    uiDefinition: {
                      displayName: 'Agent Http Port',
                      description: 'The agent http port',
                      constraints: {
                        required: 'false',
                        hidden: 'true',
                      },
                    },
                  },
                },
                metadata: {
                  allowSharing: false,
                },
              },
            ],
          },
          connectionParameters: {
            gateway: {
              type: 'gatewaySetting',
              gatewaySettings: {
                dataSourceType: 'UIFlow',
                connectionDetails: [],
              },
              uiDefinition: {
                displayName: 'Gateway name',
                description: 'Select the on-premises gateway to connect to',
                tooltip: 'Select the on-premises gateway to connect to',
                constraints: {
                  tabIndex: 1,
                  required: 'true',
                  capability: ['gateway'],
                },
              },
            },
            username: {
              type: 'securestring',
              uiDefinition: {
                displayName: 'Domain and username',
                description: 'Format as domain\\username or username@domain.com',
                tooltip: 'Username credential',
                constraints: {
                  tabIndex: 2,
                  clearText: true,
                  required: 'true',
                  capability: ['gateway'],
                },
              },
            },
            password: {
              type: 'securestring',
              uiDefinition: {
                displayName: 'Password',
                description: 'Password credential',
                tooltip: 'Password credential',
                constraints: {
                  tabIndex: 3,
                  required: 'true',
                  capability: ['gateway'],
                },
              },
            },
            agentPort: {
              type: 'string',
              uiDefinition: {
                displayName: 'Agent Http Port',
                description: 'The agent http port.',
                constraints: {
                  tabIndex: 4,
                  required: 'false',
                  hidden: 'true',
                  capability: ['gateway'],
                },
              },
            },
            authType: {
              type: 'string',
              defaultValue: 'basic',
              allowedValues: [
                {
                  value: 'windows',
                },
                {
                  value: 'basic',
                },
              ],
              uiDefinition: {
                displayName: 'Authentication Type',
                description: 'Authentication type',
                tooltip: 'Authentication type',
                constraints: {
                  tabIndex: 1,
                  required: 'true',
                  hidden: 'true',
                  allowedValues: [
                    {
                      text: 'windows',
                      value: 'windows',
                    },
                    {
                      text: 'basic',
                      value: 'basic',
                    },
                  ],
                  capability: ['gateway'],
                },
              },
            },
            environment: {
              type: 'string',
              uiDefinition: {
                displayName: 'Environment id',
                description: 'Environment id',
                tooltip: 'Environment id',
                constraints: {
                  required: 'true',
                  hidden: 'true',
                },
              },
            },
            xrmInstanceUri: {
              type: 'string',
              uiDefinition: {
                displayName: 'XRM instance uri',
                description: 'The XRM instance uri',
                constraints: {
                  required: 'true',
                  hidden: 'true',
                },
              },
            },
          },
          swagger: {
            swagger: '2.0',
            info: {
              version: '1.1',
              title: 'Desktop flows',
              description: 'Enables desktop flows (previously called UI flows)',
              'x-ms-api-annotation': {
                status: 'Production',
              },
            },
            host: 'tip1-shared.azure-apim.net',
            basePath: '/apim/uiflow',
            tags: [
              {
                name: 'UIFlows',
              },
              {
                name: 'UI Flows',
              },
              {
                name: 'DesktopFlows',
              },
              {
                name: 'Desktop flows',
              },
            ],
            schemes: ['https'],
            paths: {
              '/{connectionId}/uiFlowTypes/{uiFlowType}/uiflows': {
                get: {
                  tags: ['ListUIFlows'],
                  summary: 'List desktop flows',
                  description: 'List desktop flows.',
                  operationId: 'ListUIFlows',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowType',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow type.',
                      description: 'The desktop flow type.',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        $ref: '#/definitions/Object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#list-desktop-flows',
                  },
                },
              },
              '/{connectionId}/uiFlowTypes/{uiFlowType}/uiflows/{uiFlowId}/$metadata.json': {
                get: {
                  tags: ['UIFlowMetadata'],
                  summary: 'Get desktop flow metadata',
                  description: 'Get desktop flow metadata.',
                  operationId: 'GetUIFlowMetadata',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowType',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow type.',
                      description: 'The desktop flow type.',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'uiFlowId',
                      in: 'path',
                      description: 'The desktop flow id.',
                      required: true,
                      type: 'string',
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        $ref: '#/definitions/Object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-desktop-flow-metadata',
                  },
                },
              },
              '/{connectionId}/uiFlowTypes/desktop/uiflows/{uiFlowId}/runs': {
                post: {
                  tags: ['RPA', 'Robotic Process Automation', 'RDA', 'Robotic Desktop Automation', 'Desktop', 'UI Automation', 'Frontend'],
                  summary: 'Run a flow built with Windows recorder V1 (deprecated)',
                  description:
                    'A flow will automatically run a set of steps recorded in a single app using Windows recorder (V1) (deprecated).',
                  operationId: 'ExecuteDesktopUIFlow',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowId',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow',
                      description: 'Choose an option or create your own',
                      type: 'string',
                      required: true,
                      'x-ms-dynamic-values': {
                        operationId: 'ListUIFlows',
                        parameters: {
                          uiFlowType: 'desktop',
                        },
                        'value-collection': 'value',
                        'value-path': 'workflowid',
                        'value-title': 'name',
                      },
                    },
                    {
                      name: 'runMode',
                      in: 'query',
                      'x-ms-summary': 'Run Mode',
                      description: 'Choose between running while signed in (attended) or in the background (unattended).',
                      type: 'string',
                      required: false,
                      enum: ['attended', 'unattended'],
                      'x-ms-enum-values': [
                        {
                          displayName: "Attended (runs when you're signed in)",
                          value: 'attended',
                        },
                        {
                          displayName: "Unattended (runs on a machine that's signed out)",
                          value: 'unattended',
                        },
                      ],
                    },
                    {
                      name: 'runPriority',
                      in: 'query',
                      'x-ms-summary': 'Priority',
                      description: 'Choose an option or add your own',
                      type: 'string',
                      required: false,
                      enum: ['high', 'normal'],
                      'x-ms-enum-values': [
                        {
                          displayName: 'High',
                          value: 'high',
                        },
                        {
                          displayName: 'Normal (default)',
                          value: 'normal',
                        },
                      ],
                      'x-ms-visibility': 'advanced',
                    },
                    {
                      name: 'x-ms-flow-trusted-access',
                      in: 'header',
                      'x-ms-summary': 'Skip access check.',
                      description: 'A flag allow skipping runtime access check.',
                      type: 'boolean',
                      required: false,
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'item',
                      in: 'body',
                      description: 'The inputs.',
                      required: false,
                      schema: {
                        $ref: '#/definitions/DesktopUIFlowInput',
                      },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                        'x-ms-dynamic-schema': {
                          operationId: 'GetUIFlowMetadata',
                          parameters: {
                            uiFlowType: 'desktop',
                            uiFlowId: {
                              parameter: 'uiFlowId',
                            },
                          },
                          'value-path': 'outputs/schema',
                        },
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: true,
                  'x-ms-visibility': 'important',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#run-a-flow-built-with-windows-recorder-v1-(deprecated)-%5bdeprecated%5d',
                  },
                },
              },
              '/{connectionId}/uiFlowTypes/seleniumIDE/uiflows/{uiFlowId}/runs': {
                post: {
                  tags: [
                    'RPA',
                    'Robotic Process Automation',
                    'UI Automation',
                    'Frontend',
                    'Selenium',
                    'Selenium IDE',
                    'Chrome',
                    'Edge',
                    'Browser Automation',
                    'Website Automation',
                  ],
                  summary: 'Run a flow built with Selenium IDE (deprecated)',
                  description:
                    'A web flow will automatically run a set of steps recorded in a single web app, using Selenium IDE (deprecated).',
                  operationId: 'ExecuteSeleniumIDEUIFlow',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowId',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow',
                      description: 'Choose an option or create your own.',
                      type: 'string',
                      required: true,
                      'x-ms-dynamic-values': {
                        operationId: 'ListUIFlows',
                        parameters: {
                          uiFlowType: 'seleniumIDE',
                        },
                        'value-collection': 'value',
                        'value-path': 'workflowid',
                        'value-title': 'name',
                      },
                    },
                    {
                      name: 'runMode',
                      in: 'query',
                      'x-ms-summary': 'Run Mode',
                      description: 'Choose between running while signed in (attended) or in the background (unattended).',
                      type: 'string',
                      required: false,
                      enum: ['attended', 'unattended'],
                      'x-ms-enum-values': [
                        {
                          displayName: "Attended (runs when you're signed in)",
                          value: 'attended',
                        },
                        {
                          displayName: "Unattended (runs on a machine that's signed out)",
                          value: 'unattended',
                        },
                      ],
                    },
                    {
                      name: 'runPriority',
                      in: 'query',
                      'x-ms-summary': 'Priority',
                      description: 'Choose an option or add your own',
                      type: 'string',
                      required: false,
                      enum: ['high', 'normal'],
                      'x-ms-enum-values': [
                        {
                          displayName: 'High',
                          value: 'high',
                        },
                        {
                          displayName: 'Normal (default)',
                          value: 'normal',
                        },
                      ],
                      'x-ms-visibility': 'advanced',
                    },
                    {
                      name: 'x-ms-flow-trusted-access',
                      in: 'header',
                      'x-ms-summary': 'Skip access check.',
                      description: 'A flag allow skipping runtime access check.',
                      type: 'boolean',
                      required: false,
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'item',
                      in: 'body',
                      description: 'The desktop flow inputs.',
                      required: true,
                      schema: {
                        $ref: '#/definitions/SeleniumIDEUIFlowInput',
                      },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                        'x-ms-dynamic-schema': {
                          operationId: 'GetUIFlowMetadata',
                          parameters: {
                            uiFlowType: 'seleniumIDE',
                            uiFlowId: {
                              parameter: 'uiFlowId',
                            },
                          },
                          'value-path': 'outputs/schema',
                        },
                      },
                      headers: {
                        'x-ms-run-id': {
                          'x-ms-summary': 'Run Id',
                          description: 'The run id.',
                          type: 'string',
                          'x-ms-visibility': 'advanced',
                        },
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: true,
                  'x-ms-visibility': 'important',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#run-a-flow-built-with-selenium-ide-(deprecated)-%5bdeprecated%5d',
                  },
                },
              },
              '/{connectionId}/uiFlowTypes/desktopV2/uiflows/{uiFlowId}/runs': {
                post: {
                  tags: ['RPA', 'Robotic Process Automation', 'RDA', 'Robotic Desktop Automation', 'Desktop', 'UI Automation', 'Frontend'],
                  summary: 'Run a flow built with Power Automate for desktop',
                  description: 'A flow will automatically run a set of steps built by Power Automate for desktop.',
                  operationId: 'RunUIFlow_V2',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowId',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow',
                      description: 'Choose an option or create your own',
                      type: 'string',
                      required: true,
                      'x-ms-dynamic-values': {
                        operationId: 'ListUIFlows',
                        parameters: {
                          uiFlowType: 'desktopV2',
                        },
                        'value-collection': 'value',
                        'value-path': 'workflowid',
                        'value-title': 'name',
                      },
                    },
                    {
                      name: 'runMode',
                      in: 'query',
                      'x-ms-summary': 'Run Mode',
                      description: 'Choose between running while signed in (attended) or in the background (unattended).',
                      type: 'string',
                      required: true,
                      enum: ['attended', 'unattended'],
                      'x-ms-enum-values': [
                        {
                          displayName: "Attended (runs when you're signed in)",
                          value: 'attended',
                        },
                        {
                          displayName: "Unattended (runs on a machine that's signed out)",
                          value: 'unattended',
                        },
                      ],
                    },
                    {
                      name: 'runPriority',
                      in: 'query',
                      'x-ms-summary': 'Priority',
                      description: 'Choose an option or add your own',
                      type: 'string',
                      required: false,
                      enum: ['high', 'normal'],
                      'x-ms-enum-values': [
                        {
                          displayName: 'High',
                          value: 'high',
                        },
                        {
                          displayName: 'Normal (default)',
                          value: 'normal',
                        },
                      ],
                      'x-ms-visibility': 'advanced',
                    },
                    {
                      name: 'x-ms-flow-trusted-access',
                      in: 'header',
                      'x-ms-summary': 'Skip access check.',
                      description: 'A flag allow skipping runtime access check.',
                      type: 'boolean',
                      required: false,
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'item',
                      in: 'body',
                      description: 'The inputs.',
                      required: false,
                      schema: {
                        $ref: '#/definitions/DesktopV2UIFlowInput',
                      },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                        'x-ms-dynamic-schema': {
                          operationId: 'GetUIFlowMetadata',
                          parameters: {
                            uiFlowType: 'desktopV2',
                            uiFlowId: {
                              parameter: 'uiFlowId',
                            },
                          },
                          'value-path': 'outputs/schema',
                        },
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'important',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#run-a-flow-built-with-power-automate-for-desktop',
                  },
                },
              },
              '/{connectionId}/uiFlowTypes/{uiFlowType}/uiflows/{uiFlowId}/runs/{runId}': {
                get: {
                  tags: ['GetRunStatus'],
                  summary: 'Gets desktop flow run',
                  description: 'Gets the desktop flow run.',
                  operationId: 'GetRunStatus',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'uiFlowType',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow type.',
                      description: 'The desktop flow type.',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'uiFlowId',
                      in: 'path',
                      'x-ms-summary': 'Desktop flow id',
                      description: 'The desktop flow id.',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      'x-ms-summary': 'Run id',
                      description: 'The run id.',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'activationFlags',
                      in: 'query',
                      'x-ms-summary': 'Activation flags',
                      description: 'The activation flags.',
                      type: 'string',
                      required: false,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                    },
                    '202': {
                      description: 'Accepted',
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#gets-desktop-flow-run',
                  },
                },
              },
              '/{connectionId}/usersession/testconnection': {
                get: {
                  tags: ['TestConnection'],
                  summary: 'Test the desktop flow service connection',
                  description: 'Test the desktop flow service connection.',
                  operationId: 'TestConnection',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#test-the-desktop-flow-service-connection',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}': {
                put: {
                  tags: ['ExecuteScriptInternal'],
                  summary: 'Execute script internal',
                  description: 'Execute script internal.',
                  operationId: 'ExecuteScriptInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'item',
                      in: 'body',
                      description: 'The inputs.',
                      required: false,
                      schema: {
                        $ref: '#/definitions/Object',
                      },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#execute-script-internal',
                  },
                },
                get: {
                  tags: ['GetScriptRunInternal'],
                  summary: 'Get script run internal',
                  description: 'Get script run internal.',
                  operationId: 'GetScriptRunInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-script-run-internal',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/childScripts/{childScriptId}/childRuns/{childRunId}': {
                get: {
                  tags: ['GetChildScriptRunInternal'],
                  summary: 'Get child script run internal',
                  description: 'Get child script run internal.',
                  operationId: 'GetChildScriptRunInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'childScriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'childRunId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-child-script-run-internal',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/actions': {
                get: {
                  tags: ['GetScriptRunActionsInternal'],
                  summary: 'Get script run actions internal',
                  description: 'Get script run internal.',
                  operationId: 'GetScriptRunActionsInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-script-run-actions-internal',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/childScripts/{childScriptId}/childRuns/{childRunId}/actions': {
                get: {
                  tags: ['GetChildScriptRunActionsInternal'],
                  summary: 'Get child script run actions internal',
                  description: 'Get child script run internal.',
                  operationId: 'GetChildScriptRunActionsInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'childScriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'childRunId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-child-script-run-actions-internal',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/referencedBinaries/{binaryId}': {
                get: {
                  tags: ['GetScriptRunReferencedBinaryInternal'],
                  summary: 'Get script run referenced binaries internal',
                  description: 'Get script run referenced binaries internal.',
                  operationId: 'GetScriptRunReferencedBinaryInternal',
                  consumes: [],
                  produces: ['application/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'binaryId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: '$skipToken',
                      in: 'query',
                      type: 'string',
                      required: false,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-script-run-referenced-binaries-internal',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/childScripts/{childScriptId}/childRuns/{childRunId}/referencedBinaries/{binaryId}':
                {
                  get: {
                    tags: ['GetChildScriptRunReferencedBinaryInternal'],
                    summary: 'Get child script run referenced binaries internal',
                    description: 'Get child script run referenced binaries internal.',
                    operationId: 'GetChildScriptRunReferencedBinaryInternal',
                    consumes: [],
                    produces: ['application/json'],
                    parameters: [
                      {
                        name: 'connectionId',
                        in: 'path',
                        required: true,
                        type: 'string',
                        'x-ms-visibility': 'internal',
                      },
                      {
                        name: 'scriptId',
                        in: 'path',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: 'runId',
                        in: 'path',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: 'childScriptId',
                        in: 'path',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: 'childRunId',
                        in: 'path',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: 'binaryId',
                        in: 'path',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: 'api-version',
                        in: 'query',
                        type: 'string',
                        required: true,
                      },
                      {
                        name: '$skipToken',
                        in: 'query',
                        type: 'string',
                        required: false,
                      },
                    ],
                    responses: {
                      '200': {
                        description: 'OK',
                        schema: {
                          type: 'object',
                        },
                      },
                      default: {
                        description: 'Operation Failed.',
                      },
                    },
                    deprecated: false,
                    'x-ms-visibility': 'internal',
                    externalDocs: {
                      url: 'https://docs.microsoft.com/connectors/uiflow/#get-child-script-run-referenced-binaries-internal',
                    },
                  },
                },
              '/{connectionId}/status': {
                get: {
                  tags: ['status'],
                  summary: 'Get agent status',
                  description: 'Get agent status.',
                  operationId: 'Status',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: false,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#get-agent-status',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/finish': {
                put: {
                  tags: ['FinishRunInternal'],
                  summary: 'Complete script execution',
                  description: 'Complete script execution.',
                  operationId: 'FinishRunInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#complete-script-execution',
                  },
                },
              },
              '/{connectionId}/testconnection': {
                get: {
                  tags: ['TestConnectionInternal'],
                  summary: 'Test desktop flow service connection',
                  description: 'Test desktop flow service connection.',
                  operationId: 'TestConnectionInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: false,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#test-desktop-flow-service-connection',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/notifyBinariesSent': {
                post: {
                  tags: ['NotifyBinariesSentInternal'],
                  summary: 'Notify binaries required to run the script have been sent',
                  description: 'Notify binaries required to run the script have been sent.',
                  operationId: 'NotifyBinariesSentInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#notify-binaries-required-to-run-the-script-have-been-sent',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/cancel': {
                post: {
                  tags: ['Cancel'],
                  summary: 'Cancel the execution of a specific run',
                  description: 'Cancel the execution of a specific run.',
                  operationId: 'CancelInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#cancel-the-execution-of-a-specific-run',
                  },
                },
              },
              '/{connectionId}/scripts/{scriptId}/runs/{runId}/referencedBinaryGroups/{binaryGroupingId}/referencedBinaries/{binaryId}': {
                put: {
                  tags: ['SendBinaryChunkInternal'],
                  summary: 'Send chunk of binaries to be used by the script',
                  description: 'Send chunk of binaries to be used by the script.',
                  operationId: 'SendBinaryChunkInternal',
                  consumes: [],
                  produces: ['application/json', 'text/json'],
                  parameters: [
                    {
                      name: 'connectionId',
                      in: 'path',
                      required: true,
                      type: 'string',
                      'x-ms-visibility': 'internal',
                    },
                    {
                      name: 'scriptId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'runId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'binaryGroupingId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'binaryId',
                      in: 'path',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'api-version',
                      in: 'query',
                      type: 'string',
                      required: true,
                    },
                    {
                      name: 'item',
                      in: 'body',
                      description: 'The binary chunk.',
                      required: true,
                      schema: {
                        $ref: '#/definitions/RoboticProcessAutomationSendBinaryRequest',
                      },
                    },
                  ],
                  responses: {
                    '200': {
                      description: 'OK',
                      schema: {
                        type: 'object',
                      },
                    },
                    default: {
                      description: 'Operation Failed.',
                    },
                  },
                  deprecated: false,
                  'x-ms-visibility': 'internal',
                  externalDocs: {
                    url: 'https://docs.microsoft.com/connectors/uiflow/#send-chunk-of-binaries-to-be-used-by-the-script',
                  },
                },
              },
            },
            definitions: {
              DesktopUIFlowInput: {
                description: 'Desktop flow input',
                type: 'object',
                properties: {
                  schema: {
                    $ref: '#/definitions/Object',
                  },
                },
                'x-ms-dynamic-schema': {
                  operationId: 'GetUIFlowMetadata',
                  parameters: {
                    uiFlowType: 'desktop',
                    uiFlowId: {
                      parameter: 'uiFlowId',
                    },
                  },
                  'value-path': 'inputs/schema',
                },
              },
              SeleniumIDEUIFlowInput: {
                type: 'object',
                required: ['browser'],
                properties: {
                  browser: {
                    type: 'string',
                    'x-ms-summary': 'Web browser',
                    description: 'Choose the browser you’ll be using.',
                    enum: ['Microsoft Edge (Chromium)', 'Google Chrome'],
                  },
                  stepDelay: {
                    type: 'integer',
                    'x-ms-summary': 'Step delay',
                    description: 'Add a timed pause between steps (milliseconds).',
                    minimum: 0,
                    maximum: 60000,
                    'x-ms-visibility': 'advanced',
                  },
                  stepTimeout: {
                    type: 'integer',
                    'x-ms-summary': 'Auto timeout',
                    description: 'Enter the length of time before a run fails (milliseconds).',
                    minimum: 30000,
                    maximum: 3600000,
                    'x-ms-visibility': 'advanced',
                  },
                  variables: {
                    type: 'object',
                    'x-ms-dynamic-schema': {
                      operationId: 'GetUIFlowMetadata',
                      parameters: {
                        uiFlowType: 'seleniumIDE',
                        uiFlowId: {
                          parameter: 'uiFlowId',
                        },
                      },
                      'value-path': 'inputs/schema',
                    },
                  },
                },
              },
              DesktopV2UIFlowInput: {
                description: 'Power Automate for desktop flow input',
                type: 'object',
                properties: {
                  schema: {
                    $ref: '#/definitions/Object',
                  },
                },
                'x-ms-dynamic-schema': {
                  operationId: 'GetUIFlowMetadata',
                  parameters: {
                    uiFlowType: 'desktopV2',
                    uiFlowId: {
                      parameter: 'uiFlowId',
                    },
                  },
                  'value-path': 'inputs/schema',
                },
              },
              RoboticProcessAutomationSendBinaryRequest: {
                description: 'Binary chunk to be used by the script',
                type: 'object',
                properties: {
                  value: {
                    type: 'string',
                    'x-ms-summary': 'Chunk of binary',
                    description: 'Chunk of binary.',
                  },
                  chunkID: {
                    type: 'string',
                    'x-ms-summary': 'Id of the Chunk',
                    description: 'Add a timed pause between steps (milliseconds).',
                  },
                  totalChunks: {
                    type: 'string',
                    'x-ms-summary': 'number of chunks',
                    description: 'number of chunks.',
                  },
                },
              },
              Object: {
                type: 'object',
                properties: {},
              },
            },
            'x-ms-capabilities': {
              testConnection: {
                operationId: 'TestConnection',
                parameters: {},
              },
            },
            externalDocs: {
              url: 'https://docs.microsoft.com/connectors/uiflow',
            },
          },
          wadlUrl:
            'https://pafeblobtip1by.blob.core.windows.net:443/apiwadls-70a62ea2-dbc2-4399-87c3-e7c06568aff7/shared:2Duiflow?sv=2018-03-28&sr=c&sig=HhSN993euFoy2SJvFfa%2BJROEAQET1yHvFVA0OUjp6%2Fs%3D&se=2023-07-26T03%3A36%3A23Z&sp=rl',
          runtimeUrls: ['https://tip1-shared.azure-apim.net/apim/uiflow'],
          primaryRuntimeUrl: 'https://tip1-shared.azure-apim.net/apim/uiflow',
          metadata: {
            source: 'marketplace',
            brandColor: '#0066FF',
            allowSharing: false,
            useNewApimVersion: 'true',
            version: {
              previous: 'u/shgogna/globalperconnector-train2\\1.0.1641.3326',
              current: 'releases/v1.0.1649\\1.0.1649.3368',
            },
          },
          capabilities: ['triggers', 'actions', 'gateway'],
          interfaces: {},
          description: 'Enables desktop flows (previously called UI flows)',
          createdTime: '2019-09-09T20:43:42.2977665Z',
          changedTime: '2023-07-17T20:44:37.2853637Z',
          releaseTag: 'Production',
          tier: 'Premium',
          publisher: 'Microsoft',
        },
      } as unknown as Connector;
    }

    if (!isArmResourceId(connectorId)) {
      const { apiVersion, baseUrl, httpClient } = this._options;
      return httpClient.get<Connector>({
        uri: `${baseUrl}/operationGroups/${connectorId.split('/').at(-1)}?api-version=${apiVersion}`,
      });
    } else {
      return this._getAzureConnector(connectorId);
    }
  }

  override async getConnections(connectorId?: string): Promise<Connection[]> {
    if (connectorId) {
      return this.getConnectionsForConnector(connectorId);
    }

    const [localConnections, apiHubConnections] = await Promise.all([this._options.readConnections(), this.getConnectionsInApiHub()]);
    const serviceProviderConnections = (localConnections[serviceProviderLocation] || {}) as Record<string, ServiceProviderConnectionModel>;
    const functionConnections = (localConnections[functionsLocation] || {}) as Record<string, FunctionsConnectionModel>;
    const apimConnections = (localConnections[apimLocation] || {}) as Record<string, APIManagementConnectionModel>;

    this._allConnectionsInitialized = true;
    return [
      ...Object.keys(serviceProviderConnections).map((key) => {
        const connection = convertServiceProviderConnectionDataToConnection(key, serviceProviderConnections[key]);
        this._connections[connection.id] = connection;
        return connection;
      }),
      ...Object.keys(functionConnections).map((key) => {
        const connection = convertFunctionsConnectionDataToConnection(key, functionConnections[key]);
        this._connections[connection.id] = connection;
        return connection;
      }),
      ...Object.keys(apimConnections).map((key) => {
        const connection = convertApimConnectionDataToConnection(key, apimConnections[key]);
        this._connections[connection.id] = connection;
        return connection;
      }),
      ...apiHubConnections,
    ];
  }

  override async getConnectorAndSwagger(connectorId: string) {
    if (connectorId === '/providers/Microsoft.PowerApps/apis/shared_uiflow') {
      console.log(connectorId);
      const connector = await this.getConnector(connectorId);
      return {
        connector,
        swagger: connector.properties.swagger,
      };
    }

    return super.getConnectorAndSwagger(connectorId);
  }

  async createConnection(
    connectionId: string,
    connector: Connector,
    connectionInfo: ConnectionCreationInfo,
    parametersMetadata?: ConnectionParametersMetadata,
    shouldTestConnection = true
  ): Promise<Connection> {
    const connectionName = connectionId.split('/').at(-1) as string;

    const logId = LoggerService().startTrace({
      action: 'createConnection',
      name: 'Creating Connection',
      source: 'connection.ts',
    });

    try {
      const connection = isArmResourceId(connector.id)
        ? await this._createConnectionInApiHub(connectionName, connector.id, connectionInfo, shouldTestConnection)
        : await this.createConnectionInLocal(connectionName, connector, connectionInfo, parametersMetadata as ConnectionParametersMetadata);

      LoggerService().endTrace(logId, { status: Status.Success });
      return connection;
    } catch (error) {
      this.deleteConnection(connectionId);
      const errorMessage = `Failed to create connection: ${this.tryParseErrorMessage(error)}`;
      LoggerService().log({
        level: LogEntryLevel.Error,
        area: 'createConnection',
        message: errorMessage,
        error: error instanceof Error ? error : undefined,
        traceId: logId,
      });
      LoggerService().endTrace(logId, { status: Status.Failure });
      return Promise.reject(errorMessage);
    }
  }

  private async createConnectionInLocal(
    connectionName: string,
    connector: Connector,
    connectionInfo: ConnectionCreationInfo,
    parametersMetadata: ConnectionParametersMetadata
  ): Promise<Connection> {
    const { writeConnection, connectionCreationClients } = this._options;
    const connectionCreationClientName = parametersMetadata.connectionMetadata?.connectionCreationClient;
    if (connectionCreationClientName) {
      if (connectionCreationClients?.[connectionCreationClientName]) {
        // eslint-disable-next-line no-param-reassign
        connectionInfo = await connectionCreationClients[connectionCreationClientName].connectionCreationFunc(
          connectionInfo,
          connectionName
        );
      } else {
        throw new AssertionException(
          AssertionErrorCode.CONNECTION_CREATION_CLIENT_NOTREGISTERED,
          `The connection creation client for ${connectionCreationClientName} is not registered`
        );
      }
    }

    if (!writeConnection) {
      throw new AssertionException(AssertionErrorCode.CALLBACK_NOTREGISTERED, 'Callback for write connection is not passed in service.');
    }

    const { connectionsData, connection } = await this._getConnectionsConfiguration(
      connectionName,
      connectionInfo,
      connector,
      parametersMetadata
    );

    await this._options.writeConnection?.(connectionsData);
    this._connections[connection.id] = connection;

    return connection;
  }

  private async _createConnectionInApiHub(
    connectionName: string,
    connectorId: string,
    connectionInfo: ConnectionCreationInfo,
    shouldTestConnection: boolean
  ): Promise<Connection> {
    const { workflowAppDetails } = this._options;
    const intl = getIntl();

    // NOTE: Block connection creation if identity does not exist on Logic App.
    if (workflowAppDetails && !isIdentityAssociatedWithLogicApp(workflowAppDetails.identity)) {
      throw new Error(
        intl.formatMessage({
          defaultMessage: 'To create and use an API connection, you must have a managed identity configured on this logic app.',
          description: 'Error message to show when logic app does not have managed identity when creating azure connection',
        })
      );
    }

    const connectionId = this.getAzureConnectionRequestPath(connectionName);
    const connection = await this.createConnectionInApiHub(connectionName, connectorId, connectionInfo);

    try {
      await this._createConnectionAclIfNeeded(connection);
    } catch {
      // NOTE: Delete the connection created in this method if Acl creation failed.
      this.deleteConnection(connectionId);
      const error = new Error(
        intl.formatMessage({
          defaultMessage: 'Acl creation failed for connection. Deleting the connection.',
          description: 'Error while creating acl',
        })
      );
      throw error;
    }

    if (shouldTestConnection) {
      await this.testConnection(connection);
    }

    return connection;
  }

  // Run when assigning a conneciton to an operation
  override async setupConnectionIfNeeded(connection: Connection, identityId?: string): Promise<void> {
    await this._createConnectionAclIfNeeded(connection, identityId);
  }

  private async _createConnectionAclIfNeeded(connection: Connection, identityId?: string): Promise<void> {
    const {
      apiHubServiceDetails: { tenantId },
      workflowAppDetails,
    } = this._options;
    if (!isArmResourceId(connection.id) || !workflowAppDetails) {
      return;
    }

    const intl = getIntl();

    if (!isIdentityAssociatedWithLogicApp(workflowAppDetails.identity)) {
      throw new Error(
        intl.formatMessage({
          defaultMessage: 'A managed identity is not configured on the logic app.',
          description: 'Error message when no identity is associated',
        })
      );
    }

    const connectionAcls = (await this._getConnectionAcls(connection.id)) || [];
    const { identity, appName } = workflowAppDetails;
    const identityDetailsForApiHubAuth = this._getIdentityDetailsForApiHubAuth(identity as ManagedIdentity, tenantId as string, identityId);

    try {
      if (
        !connectionAcls.some((acl) => {
          const { identity: principalIdentity } = acl.properties.principal;
          return principalIdentity.objectId === identityDetailsForApiHubAuth.principalId && principalIdentity.tenantId === tenantId;
        })
      ) {
        await this._createAccessPolicyInConnection(connection.id, appName, identityDetailsForApiHubAuth, connection.location as string);
      }
    } catch {
      LoggerService().log({
        level: LogEntryLevel.Error,
        area: 'ConnectionACLCreate',
        message: 'Acl creation failed for connection.',
      });
    }
  }

  private async _getConnectionAcls(connectionId: string): Promise<ConnectionAcl[]> {
    const {
      apiHubServiceDetails: { apiVersion },
      httpClient,
    } = this._options;

    // TODO: Handle nextLink from this response as well.
    const response = await httpClient.get<any>({
      uri: `${connectionId}/accessPolicies`,
      queryParameters: { 'api-version': apiVersion },
      headers: { 'x-ms-command-name': 'LADesigner.getConnectionAcls' },
    });

    return response.value;
  }

  private async _createAccessPolicyInConnection(
    connectionId: string,
    appName: string,
    identityDetails: Record<string, any>,
    location: string
  ): Promise<void> {
    const {
      apiHubServiceDetails: { apiVersion, baseUrl },
      httpClient,
    } = this._options;
    const { principalId: objectId, tenantId } = identityDetails;
    const policyName = `${appName}-${objectId}`;

    await httpClient.put({
      uri: `${baseUrl}${connectionId}/accessPolicies/${policyName}`,
      queryParameters: { 'api-version': apiVersion },
      headers: {
        'If-Match': '*',
        'x-ms-command-name': 'LADesigner.createAccessPolicyInConnection',
      },
      content: {
        name: appName,
        type: 'Microsoft.Web/connections/accessPolicy',
        location,
        properties: {
          principal: {
            type: 'ActiveDirectory',
            identity: { objectId, tenantId },
          },
        },
      },
    });
  }

  // NOTE: Use the system-assigned MI if exists, else use the first user assigned identity if identity is not specified.
  private _getIdentityDetailsForApiHubAuth(
    managedIdentity: ManagedIdentity,
    tenantId: string,
    identityIdForConnection: string | undefined
  ): { principalId: string; tenantId: string } {
    if (
      !identityIdForConnection &&
      (equals(managedIdentity.type, ResourceIdentityType.SYSTEM_ASSIGNED) ||
        equals(managedIdentity.type, ResourceIdentityType.SYSTEM_ASSIGNED_USER_ASSIGNED))
    ) {
      return { principalId: managedIdentity.principalId as string, tenantId: managedIdentity.tenantId as string };
    } else {
      const identityKeys = Object.keys(managedIdentity.userAssignedIdentities ?? {});
      const selectedIdentity = identityKeys.find((identityKey) => equals(identityKey, identityIdForConnection)) ?? identityKeys[0];
      return {
        principalId: managedIdentity.userAssignedIdentities?.[selectedIdentity].principalId as string,
        tenantId,
      };
    }
  }

  async createAndAuthorizeOAuthConnection(
    connectionId: string,
    connectorId: string,
    connectionInfo: ConnectionCreationInfo,
    parametersMetadata?: ConnectionParametersMetadata
  ): Promise<CreateConnectionResult> {
    const connector = await this.getConnector(connectorId);
    const connection = await this.createConnection(
      connectionId,
      connector,
      connectionInfo,
      parametersMetadata,
      /* shouldTestConnection */ false
    );
    const oAuthService = OAuthService();
    let oAuthPopupInstance: IOAuthPopup | undefined;

    try {
      const consentUrl = await oAuthService.fetchConsentUrlForConnection(connectionId);
      oAuthPopupInstance = oAuthService.openLoginPopup({ consentUrl });

      const loginResponse = await oAuthPopupInstance.loginPromise;
      if (loginResponse.error) {
        throw new Error(atob(loginResponse.error));
      } else if (loginResponse.code) {
        await oAuthService.confirmConsentCodeForConnection(connectionId, loginResponse.code);
      }

      await this._createConnectionAclIfNeeded(connection);

      const fetchedConnection = await this.getConnection(connection.id);
      await this.testConnection(fetchedConnection);

      return { connection: fetchedConnection };
    } catch (error: any) {
      this.deleteConnection(connectionId);
      const errorMessage = `Failed to create OAuth connection: ${this.tryParseErrorMessage(error)}`;
      LoggerService().log({
        level: LogEntryLevel.Error,
        area: 'create oauth connection',
        message: errorMessage,
        error: error instanceof Error ? error : undefined,
      });
      return { errorMessage: this.tryParseErrorMessage(error) };
    }
  }

  private async _getConnectionsConfiguration(
    connectionName: string,
    connectionInfo: ConnectionCreationInfo,
    connector: Connector,
    parametersMetadata: ConnectionParametersMetadata
  ): Promise<{
    connectionsData: ConnectionAndAppSetting<LocalConnectionModel>;
    connection: Connection;
  }> {
    const connectionType = parametersMetadata?.connectionMetadata?.type;
    let connectionsData;
    let connection;
    switch (connectionType) {
      case ConnectionType.Function: {
        connectionsData = convertToFunctionsConnectionsData(connectionName, connectionInfo);
        connection = convertFunctionsConnectionDataToConnection(
          connectionsData.connectionKey,
          connectionsData.connectionData as FunctionsConnectionModel
        );
        break;
      }
      case ConnectionType.ApiManagement: {
        connectionsData = convertToApimConnectionsData(connectionName, connectionInfo);
        connection = convertApimConnectionDataToConnection(
          connectionsData.connectionKey,
          connectionsData.connectionData as APIManagementConnectionModel
        );
        break;
      }
      default: {
        const { connectionAndSettings, rawConnection } = convertToServiceProviderConnectionsData(
          connectionName,
          connector.id,
          connectionInfo,
          parametersMetadata
        );
        connectionsData = connectionAndSettings;
        connection = convertServiceProviderConnectionDataToConnection(
          connectionsData.connectionKey,
          connectionsData.connectionData as ServiceProviderConnectionModel
        );

        if (connector.properties.testConnectionUrl) {
          await this._testServiceProviderConnection(connector.properties.testConnectionUrl, rawConnection);
        }
        break;
      }
    }
    return { connectionsData, connection };
  }

  private async _testServiceProviderConnection(
    requestUrl: string,
    connectionData: ServiceProviderConnectionModel
  ): Promise<HttpResponse<any>> {
    try {
      const { httpClient, baseUrl, apiVersion } = this._options;
      const response = await httpClient.post<any, any>({
        uri: `${baseUrl.replace('/runtime/webhooks/workflow/api/management', '')}${requestUrl}`,
        queryParameters: { 'api-version': apiVersion },
        content: connectionData,
      });

      if (!response || response.status < 200 || response.status >= 300) {
        throw response;
      }

      return response;
    } catch (e: any) {
      return Promise.reject(e);
    }
  }
}

function convertServiceProviderConnectionDataToConnection(
  connectionKey: string,
  connectionData: ServiceProviderConnectionModel
): Connection {
  const {
    displayName,
    serviceProvider: { id: apiId },
  } = connectionData;

  return {
    name: connectionKey,
    id: `${apiId}/connections/${connectionKey}`,
    type: 'connections',
    properties: {
      api: { id: apiId } as any,
      createdTime: '',
      connectionParameters: {},
      displayName: displayName as string,
      statuses: [{ status: 'Connected' }],
      overallStatus: 'Connected',
      testLinks: [],
    },
  };
}

function convertApimConnectionDataToConnection(connectionKey: string, connectionData: APIManagementConnectionModel): Connection {
  const { displayName } = connectionData;

  return {
    name: connectionKey,
    id: `${apiManagementConnectorId}/connections/${connectionKey}`,
    type: 'connections',
    properties: {
      api: { id: apiManagementConnectorId } as any,
      createdTime: '',
      connectionParameters: {},
      displayName: displayName as string,
      overallStatus: 'Connected',
      statuses: [{ status: 'Connected' }],
      testLinks: [],
    },
  };
}

function convertFunctionsConnectionDataToConnection(connectionKey: string, connectionData: FunctionsConnectionModel): Connection {
  const { displayName } = connectionData;

  return {
    name: connectionKey,
    id: `${azureFunctionConnectorId}/connections/${connectionKey}`,
    type: 'connections',
    properties: {
      api: { id: azureFunctionConnectorId } as any,
      createdTime: '',
      connectionParameters: {},
      displayName: displayName as string,
      overallStatus: 'Connected',
      statuses: [{ status: 'Connected' }],
      testLinks: [],
    },
  };
}

function convertToServiceProviderConnectionsData(
  connectionKey: string,
  connectorId: string,
  connectionInfo: ConnectionCreationInfo,
  connectionParameterMetadata: ConnectionParametersMetadata
): { connectionAndSettings: ConnectionAndAppSetting<ServiceProviderConnectionModel>; rawConnection: ServiceProviderConnectionModel } {
  const {
    displayName,
    connectionParameters: connectionParameterValues,
    connectionParametersSet: connectionParametersSetValues,
  } = connectionInfo;
  const connectionParameters = connectionParametersSetValues
    ? connectionParameterMetadata.connectionParameterSet?.parameters
    : (connectionParameterMetadata.connectionParameters as Record<string, ConnectionParameter>);
  const parameterValues = connectionParametersSetValues
    ? Object.keys(connectionParametersSetValues.values).reduce(
        (result: Record<string, any>, currentKey: string) => ({
          ...result,
          [currentKey]: connectionParametersSetValues.values[currentKey].value,
        }),
        {}
      )
    : (connectionParameterValues as Record<string, any>);

  const connectionsData: ConnectionAndAppSetting<ServiceProviderConnectionModel> = {
    connectionKey,
    connectionData: {
      parameterValues: {},
      ...optional('parameterSetName', connectionParametersSetValues?.name),
      serviceProvider: { id: connectorId },
      displayName,
    },
    settings: connectionInfo.appSettings ?? {},
    pathLocation: [serviceProviderLocation],
  };
  const rawConnection = createCopy(connectionsData.connectionData);

  for (const parameterKey of Object.keys(parameterValues)) {
    const connectionParameter = connectionParameters?.[parameterKey] as ConnectionParameter;
    let parameterValue = parameterValues[parameterKey];
    const rawValue = parameterValue;
    if (connectionParameter?.parameterSource === ConnectionParameterSource.AppConfiguration) {
      const appSettingName = `${escapeSpecialChars(connectionKey)}_${escapeSpecialChars(parameterKey)}`;
      connectionsData.settings[appSettingName] = parameterValues[parameterKey];

      parameterValue = `@appsetting('${appSettingName}')`;
    }

    safeSetObjectPropertyValue(
      connectionsData.connectionData.parameterValues,
      [...(connectionParameter?.uiDefinition?.constraints?.propertyPath ?? []), parameterKey],
      parameterValue
    );
    safeSetObjectPropertyValue(
      rawConnection.parameterValues,
      [...(connectionParameter?.uiDefinition?.constraints?.propertyPath ?? []), parameterKey],
      rawValue
    );
  }

  return { connectionAndSettings: connectionsData, rawConnection };
}

function convertToFunctionsConnectionsData(
  connectionKey: string,
  connectionInfo: ConnectionCreationInfo
): ConnectionAndAppSetting<FunctionsConnectionModel> {
  const { displayName, connectionParameters } = connectionInfo;
  const authentication = connectionParameters?.['authentication'];
  const functionAppKey = authentication.value;
  const appSettingName = `${escapeSpecialChars(connectionKey)}_functionAppKey`;

  authentication.value = `@appsetting('${appSettingName}')`;

  return {
    connectionKey,
    connectionData: {
      function: connectionParameters?.['function'],
      triggerUrl: connectionParameters?.['triggerUrl'],
      authentication,
      displayName,
    },
    settings: { [appSettingName]: functionAppKey },
    pathLocation: [functionsLocation],
  };
}

function convertToApimConnectionsData(
  connectionKey: string,
  connectionInfo: ConnectionCreationInfo
): ConnectionAndAppSetting<APIManagementConnectionModel> {
  const { displayName, connectionParameters } = connectionInfo;
  const subscriptionKey = connectionParameters?.['subscriptionKey'];
  const appSettingName = `${escapeSpecialChars(connectionKey)}_SubscriptionKey`;

  return {
    connectionKey,
    connectionData: {
      apiId: connectionParameters?.['apiId'],
      baseUrl: connectionParameters?.['baseUrl'],
      subscriptionKey: `@appsetting('${appSettingName}')`,
      authentication: connectionParameters?.['authentication'],
      displayName,
    },
    settings: { [appSettingName]: subscriptionKey },
    pathLocation: [apimLocation],
  };
}

function escapeSpecialChars(value: string): string {
  const escapedUnderscore = value.replace(/_/g, '__');
  return escapedUnderscore.replace(/-/g, '_1');
}
