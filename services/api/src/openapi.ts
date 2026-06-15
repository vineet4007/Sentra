/**
 * OpenAPI 3.1 specification for Sentra API
 * Generated programmatically from route definitions
 */

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Sentra API',
    version: '0.2.0-beta.1',
    description: 'Real-time, multi-cloud deployment intelligence and control',
    contact: {
      name: 'AshSan Labs',
      url: 'https://github.com/ashsan/sentra',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: 'https://api.example.com',
      description: 'Production API',
    },
    {
      url: 'http://localhost:8080',
      description: 'Local development',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        operationId: 'getHealth',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/projects/onboard': {
      post: {
        summary: 'Onboard a new project',
        operationId: 'onboardProject',
        tags: ['Projects'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectName', 'services', 'environments'],
                properties: {
                  projectName: { type: 'string' },
                  repoUrl: { type: 'string', nullable: true },
                  description: { type: 'string', nullable: true },
                  services: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['name', 'deploymentTargetType'],
                      properties: {
                        name: { type: 'string' },
                        deploymentTargetType: {
                          type: 'string',
                          enum: ['Kubernetes', 'Lambda', 'CloudRun', 'ContainerApps'],
                        },
                        deploymentTargetConfig: { type: 'object' },
                      },
                    },
                  },
                  environments: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        deploymentTargetConfig: { type: 'object' },
                        telemetrySourceConfig: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Project onboarded successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectName: { type: 'string' },
                    projectId: { type: 'number' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/projects': {
      get: {
        summary: 'List projects',
        operationId: 'listProjects',
        tags: ['Projects'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0, minimum: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Projects list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Project' },
                    },
                    total: { type: 'number' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        summary: 'Create project',
        operationId: 'createProject',
        tags: ['Projects'],
        security: [{ bearerAuth: [], actionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  repoUrl: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Project created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Project' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/projects/{projectId}': {
      get: {
        summary: 'Get project details',
        operationId: 'getProject',
        tags: ['Projects'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
          },
        ],
        responses: {
          '200': {
            description: 'Project details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Project' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/deployments': {
      get: {
        summary: 'List deployments',
        operationId: 'listDeployments',
        tags: ['Deployments'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'serviceId',
            in: 'query',
            schema: { type: 'number' },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Deployments list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Deployment' },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        summary: 'Start a deployment',
        operationId: 'startDeployment',
        tags: ['Deployments'],
        security: [{ bearerAuth: [], actionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['serviceId', 'environmentId', 'imageRef', 'revision'],
                properties: {
                  serviceId: { type: 'number' },
                  environmentId: { type: 'number' },
                  policyId: { type: 'number' },
                  imageRef: { type: 'string' },
                  revision: { type: 'string' },
                  source: { type: 'string', default: 'manual' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Deployment started',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Deployment' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/rollouts': {
      get: {
        summary: 'List rollouts',
        operationId: 'listRollouts',
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Rollouts list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Rollout' },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/rollouts/live': {
      get: {
        summary: 'Get live rollout states',
        operationId: 'getLiveRollouts',
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Live rollout states',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/RolloutLiveState' },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/rollouts/{rolloutId}': {
      get: {
        summary: 'Get rollout details',
        operationId: 'getRollout',
        tags: ['Rollouts'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'rolloutId',
            in: 'path',
            required: true,
            schema: { type: 'number' },
          },
        ],
        responses: {
          '200': {
            description: 'Rollout details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Rollout' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/policies': {
      get: {
        summary: 'List rollout policies',
        operationId: 'listPolicies',
        tags: ['Policies'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Policies list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/RolloutPolicy' },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        summary: 'Create rollout policy',
        operationId: 'createPolicy',
        tags: ['Policies'],
        security: [{ bearerAuth: [], actionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RolloutPolicy' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Policy created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RolloutPolicy' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/events': {
      get: {
        summary: 'Stream live rollout events',
        operationId: 'streamEvents',
        tags: ['Events'],
        security: [{ bearerAuth: [] }],
        description: 'Server-Sent Events (SSE) stream for real-time rollout state updates',
        responses: {
          '200': {
            description: 'Event stream established',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'object',
                  properties: {
                    event: { type: 'string' },
                    data: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'token',
        description: 'Bearer token for read access. Format: Bearer <tenantKey>:<token>',
      },
      actionAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'action-token',
        description: 'Action authority token for write operations. Format: Bearer <tenantKey>:<token>',
      },
    },
    schemas: {
      Project: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          repoUrl: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Deployment: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          serviceId: { type: 'number' },
          environmentId: { type: 'number' },
          policyId: { type: 'number', nullable: true },
          imageRef: { type: 'string' },
          revision: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'active', 'completed', 'failed', 'rolled-back'] },
          currentWeight: { type: 'number' },
          lastDecision: { type: 'string', nullable: true },
          lastDecisionReason: { type: 'string', nullable: true },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Rollout: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          deploymentId: { type: 'number' },
          status: { type: 'string' },
          currentWeight: { type: 'number' },
          currentStep: { type: 'number' },
          totalSteps: { type: 'number' },
          gateResults: { type: 'array', items: { type: 'object' } },
        },
      },
      RolloutLiveState: {
        type: 'object',
        properties: {
          deploymentId: { type: 'number' },
          weight: { type: 'number' },
          step: { type: 'number' },
          status: { type: 'string' },
          lastUpdate: { type: 'string', format: 'date-time' },
        },
      },
      RolloutPolicy: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          rolloutSteps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                weight: { type: 'number' },
                duration: { type: 'string' },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad request',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - invalid or missing authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
              },
            },
          },
        },
      },
      Forbidden: {
        description: 'Forbidden - insufficient permissions',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
              },
            },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}
